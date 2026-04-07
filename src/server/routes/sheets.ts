import { Router } from 'express';
import { getStore } from '../../store/index.js';
import { generateId } from '../../util/id.js';

export function sheetsRoutes(): Router {
  const r = Router();
  const PREFIX = '/v4/spreadsheets';

  // In-memory cell values: key = "spreadsheetId:sheetTitle" -> string[][]
  const cellValues: Record<string, string[][]> = {};

  function getValues(spreadsheetId: string, sheetTitle: string): string[][] {
    const key = `${spreadsheetId}::${sheetTitle}`; // double colon to avoid key collision
    if (!cellValues[key]) cellValues[key] = [];
    return cellValues[key];
  }

  function setCell(grid: string[][], row: number, col: number, value: string): void {
    while (grid.length <= row) grid.push([]);
    while (grid[row].length <= col) grid[row].push('');
    grid[row][col] = value;
  }

  function parseRange(range: string): { sheet: string; startRow: number; startCol: number; endRow: number; endCol: number } {
    let sheet = 'Sheet1';
    let cellRange = range;
    if (range.includes('!')) {
      const parts = range.split('!');
      sheet = parts[0].replace(/^'|'$/g, '');
      cellRange = parts[1];
    }
    const colToNum = (c: string) => {
      let n = 0;
      for (const ch of c.toUpperCase()) n = n * 26 + ch.charCodeAt(0) - 64;
      return n - 1;
    };
    const parseCell = (cell: string) => {
      const m = cell.match(/^([A-Za-z]+)(\d+)$/);
      if (!m) return { row: 0, col: 0 };
      return { row: parseInt(m[2]) - 1, col: colToNum(m[1]) };
    };
    const parts = cellRange.split(':');
    const start = parseCell(parts[0]);
    const end = parts[1] ? parseCell(parts[1]) : start;
    return { sheet, startRow: start.row, startCol: start.col, endRow: end.row, endCol: end.col };
  }

  // Helper to extract spreadsheetId from params that may include :action suffix
  function ssId(raw: string): string {
    return raw.replace(/:.*$/, '');
  }

  // CREATE spreadsheet
  r.post(PREFIX, (req, res) => {
    const store = getStore();
    const id = generateId();
    const ss = {
      spreadsheetId: id,
      properties: {
        title: req.body.properties?.title || 'Untitled',
        locale: req.body.properties?.locale || 'en_US',
        timeZone: req.body.properties?.timeZone || 'UTC',
      },
      sheets: req.body.sheets || [{
        properties: { sheetId: 0, title: 'Sheet1', index: 0, sheetType: 'GRID', gridProperties: { rowCount: 1000, columnCount: 26 } },
      }],
      spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${id}/edit`,
    };
    store.sheets.spreadsheets[id] = ss;
    res.json(ss);
  });

  // GET spreadsheet
  r.get(`${PREFIX}/:spreadsheetId`, (req, res) => {
    const ss = getStore().sheets.spreadsheets[req.params.spreadsheetId];
    if (!ss) {
      return res.status(404).json({ error: { code: 404, message: 'Spreadsheet not found.', status: 'NOT_FOUND' } });
    }
    res.json(ss);
  });

  // BATCH UPDATE — matches :batchUpdate suffix via wildcard
  r.post(`${PREFIX}/:rest`, (req, res, next) => {
    if (!req.params.rest.includes(':batchUpdate')) return next();
    const id = ssId(req.params.rest);
    const ss = getStore().sheets.spreadsheets[id];
    if (!ss) {
      return res.status(404).json({ error: { code: 404, message: 'Spreadsheet not found.', status: 'NOT_FOUND' } });
    }
    const replies = (req.body.requests || []).map(() => ({}));
    res.json({ spreadsheetId: ss.spreadsheetId, replies });
  });

  // GET values
  r.get(`${PREFIX}/:spreadsheetId/values/:range`, (req, res) => {
    const ss = getStore().sheets.spreadsheets[req.params.spreadsheetId];
    if (!ss) {
      return res.status(404).json({ error: { code: 404, message: 'Spreadsheet not found.', status: 'NOT_FOUND' } });
    }
    const parsed = parseRange(req.params.range);
    const grid = getValues(req.params.spreadsheetId, parsed.sheet);
    const values: string[][] = [];
    for (let r = parsed.startRow; r <= parsed.endRow; r++) {
      const row: string[] = [];
      for (let c = parsed.startCol; c <= parsed.endCol; c++) {
        row.push(grid[r]?.[c] || '');
      }
      values.push(row);
    }
    res.json({ range: req.params.range, majorDimension: 'ROWS', values });
  });

  // UPDATE values (PUT)
  r.put(`${PREFIX}/:spreadsheetId/values/:range`, (req, res) => {
    const ss = getStore().sheets.spreadsheets[req.params.spreadsheetId];
    if (!ss) {
      return res.status(404).json({ error: { code: 404, message: 'Spreadsheet not found.', status: 'NOT_FOUND' } });
    }
    const parsed = parseRange(req.params.range);
    const grid = getValues(req.params.spreadsheetId, parsed.sheet);
    const values: string[][] = req.body.values || [];
    let updatedCells = 0;
    for (let ri = 0; ri < values.length; ri++) {
      for (let ci = 0; ci < values[ri].length; ci++) {
        setCell(grid, parsed.startRow + ri, parsed.startCol + ci, values[ri][ci]);
        updatedCells++;
      }
    }
    res.json({
      spreadsheetId: req.params.spreadsheetId,
      updatedRange: req.params.range,
      updatedRows: values.length,
      updatedColumns: values[0]?.length || 0,
      updatedCells,
    });
  });

  // APPEND, CLEAR, BATCH GET, BATCH UPDATE, BATCH CLEAR — match via wildcard
  // These use :action suffix on the range or spreadsheetId

  // Handle /spreadsheets/:id/values/:range:append
  r.post(`${PREFIX}/:spreadsheetId/values/:rest`, (req, res) => {
    const ss = getStore().sheets.spreadsheets[req.params.spreadsheetId];
    if (!ss) {
      return res.status(404).json({ error: { code: 404, message: 'Spreadsheet not found.', status: 'NOT_FOUND' } });
    }

    const rest = req.params.rest;

    if (rest.includes(':append')) {
      const range = rest.replace(/:append$/, '');
      const parsed = parseRange(range);
      const grid = getValues(req.params.spreadsheetId, parsed.sheet);
      const values: string[][] = req.body.values || [];
      const startRow = grid.length;
      let updatedCells = 0;
      for (let ri = 0; ri < values.length; ri++) {
        for (let ci = 0; ci < values[ri].length; ci++) {
          setCell(grid, startRow + ri, parsed.startCol + ci, values[ri][ci]);
          updatedCells++;
        }
      }
      return res.json({
        spreadsheetId: req.params.spreadsheetId,
        updates: { updatedRange: range, updatedRows: values.length, updatedColumns: values[0]?.length || 0, updatedCells },
      });
    }

    if (rest.includes(':clear')) {
      const range = rest.replace(/:clear$/, '');
      const parsed = parseRange(range);
      const grid = getValues(req.params.spreadsheetId, parsed.sheet);
      for (let r = parsed.startRow; r <= parsed.endRow && r < grid.length; r++) {
        for (let c = parsed.startCol; c <= parsed.endCol && grid[r] && c < grid[r].length; c++) {
          grid[r][c] = '';
        }
      }
      return res.json({ spreadsheetId: req.params.spreadsheetId, clearedRange: range });
    }

    if (rest === ':batchUpdate' || rest === ':batchClear') {
      return res.json({ spreadsheetId: req.params.spreadsheetId, responses: [] });
    }

    res.status(404).json({ error: { code: 404, message: 'Not found', status: 'NOT_FOUND' } });
  });

  // BATCH GET values — /spreadsheets/:id/values:batchGet
  r.get(`${PREFIX}/:rest`, (req, res, next) => {
    if (!req.params.rest.includes('/values:batchGet') && !req.params.rest.includes('/values:batchGet')) {
      // Check if it matches the pattern spreadsheetId/values:batchGet
      const match = req.path.match(/\/v4\/spreadsheets\/([^/]+)\/values:batchGet/);
      if (!match) return next();
    }
    const match = req.path.match(/\/v4\/spreadsheets\/([^/]+)\/values/);
    if (!match) return next();
    const spreadsheetId = match[1];
    const ss = getStore().sheets.spreadsheets[spreadsheetId];
    if (!ss) {
      return res.status(404).json({ error: { code: 404, message: 'Spreadsheet not found.', status: 'NOT_FOUND' } });
    }
    const ranges = (Array.isArray(req.query.ranges) ? req.query.ranges : [req.query.ranges]) as string[];
    const valueRanges = ranges.filter(Boolean).map(range => {
      const parsed = parseRange(range);
      const grid = getValues(spreadsheetId, parsed.sheet);
      const values: string[][] = [];
      for (let r = parsed.startRow; r <= parsed.endRow; r++) {
        const row: string[] = [];
        for (let c = parsed.startCol; c <= parsed.endCol; c++) {
          row.push(grid[r]?.[c] || '');
        }
        values.push(row);
      }
      return { range, majorDimension: 'ROWS', values };
    });
    res.json({ spreadsheetId, valueRanges });
  });

  // COPY sheet — /spreadsheets/:id/sheets/:sheetId:copyTo
  r.post(`${PREFIX}/:spreadsheetId/sheets/:rest`, (req, res) => {
    const ss = getStore().sheets.spreadsheets[req.params.spreadsheetId];
    if (!ss) {
      return res.status(404).json({ error: { code: 404, message: 'Spreadsheet not found.', status: 'NOT_FOUND' } });
    }
    const sheetId = parseInt(req.params.rest.replace(/:.*$/, ''));
    const destId = req.body.destinationSpreadsheetId;
    const destSs = getStore().sheets.spreadsheets[destId];
    if (!destSs) {
      return res.status(404).json({ error: { code: 404, message: 'Destination not found.', status: 'NOT_FOUND' } });
    }
    const sourceSheet = ss.sheets.find(s => s.properties.sheetId === sheetId);
    if (!sourceSheet) {
      return res.status(404).json({ error: { code: 404, message: 'Sheet not found.', status: 'NOT_FOUND' } });
    }
    const newSheetId = destSs.sheets.length;
    const copy = { ...sourceSheet, properties: { ...sourceSheet.properties, sheetId: newSheetId, index: destSs.sheets.length } };
    destSs.sheets.push(copy);
    res.json(copy.properties);
  });

  return r;
}
