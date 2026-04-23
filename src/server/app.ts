import express from 'express';
import { gmailRoutes } from './routes/gmail.js';
import { calendarRoutes } from './routes/calendar.js';
import { driveRoutes } from './routes/drive.js';
import { tasksRoutes } from './routes/tasks.js';
import { sheetsRoutes } from './routes/sheets.js';
import { peopleRoutes } from './routes/people.js';
import { githubRoutes } from './routes/github.js';
import { gitHttpRoutes } from './routes/git-http.js';
import { searchRoutes } from './routes/search.js';
import { webFetchRoutes, webFetchHostDispatcher } from './routes/fetch.js';
import { controlRoutes } from './routes/control.js';
import { errorHandler } from './middleware.js';

export function createApp(): express.Express {
  const app = express();
  app.use(express.json({ limit: '10mb' }));

  app.use(controlRoutes());

  // Web Fetch host dispatcher runs BEFORE the service routes. For
  // requests forwarded by the MITM proxy with X-Fws-Original-Host set to
  // a non-allowlisted host (i.e. an arbitrary host that only got
  // intercepted because the user added a Web Fetch fixture for it), it
  // hands the request straight to the Web Fetch catch-all so a fixture
  // for `https://random.test/gmail/v1/...` doesn't get shadowed by the
  // gmail route. Requests for allowlisted service hosts and direct test
  // fetches fall through to the normal routing chain unchanged.
  app.use(webFetchHostDispatcher());

  app.use(gmailRoutes());
  app.use(calendarRoutes());
  app.use(driveRoutes());
  app.use(tasksRoutes());
  app.use(sheetsRoutes());
  app.use(peopleRoutes());
  // git smart HTTP mock lives on github.com path shape (/<owner>/<repo>.git/…)
  // while githubRoutes() handles api.github.com's REST/GraphQL. Mount the git
  // routes first — their paths end in .git which doesn't collide with the REST
  // API prefixes (`/repos`, `/user`, `/graphql`, …), but it still keeps the
  // git-clone path resolution close to where other github plumbing lives.
  app.use(gitHttpRoutes());
  app.use(githubRoutes());
  app.use(searchRoutes());
  app.use(webFetchRoutes());

  app.use(errorHandler);

  return app;
}
