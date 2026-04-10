import express from 'express';
import { gmailRoutes } from './routes/gmail.js';
import { calendarRoutes } from './routes/calendar.js';
import { driveRoutes } from './routes/drive.js';
import { tasksRoutes } from './routes/tasks.js';
import { sheetsRoutes } from './routes/sheets.js';
import { peopleRoutes } from './routes/people.js';
import { githubRoutes } from './routes/github.js';
import { searchRoutes } from './routes/search.js';
import { controlRoutes } from './routes/control.js';
import { errorHandler } from './middleware.js';

export function createApp(): express.Express {
  const app = express();
  app.use(express.json({ limit: '10mb' }));

  app.use(controlRoutes());
  app.use(gmailRoutes());
  app.use(calendarRoutes());
  app.use(driveRoutes());
  app.use(tasksRoutes());
  app.use(sheetsRoutes());
  app.use(peopleRoutes());
  app.use(githubRoutes());
  app.use(searchRoutes());

  app.use(errorHandler);

  return app;
}
