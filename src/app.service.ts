import { Injectable } from '@nestjs/common';

/**
 * Fixed the moment the process starts, so it dates the running build rather
 * than the request.
 */
const STARTED_AT = new Date();

/**
 * Whatever the deployment happened to tell us about the build. Coolify sets
 * SOURCE_COMMIT; other hosts use other names. Absent is fine — startedAt
 * alone answers "did my push actually land", which is the question that keeps
 * being asked and could not be answered from outside.
 */
const COMMIT =
  process.env.SOURCE_COMMIT ??
  process.env.GIT_COMMIT ??
  process.env.COMMIT_SHA ??
  null;

@Injectable()
export class AppService {
  healthCheck() {
    return {
      status: 'ok',
      // Compare against the time of a push: an older startedAt means the
      // deploy has not landed yet, whatever the dashboard says.
      startedAt: STARTED_AT.toISOString(),
      uptimeSeconds: Math.floor(process.uptime()),
      commit: COMMIT,
    };
  }

  testApi() {
    return {
      status: 'success',
      massage: 'API is working',
      timestamp: new Date().toISOString(),
      version: '1.0.0',
    };
  }
}
