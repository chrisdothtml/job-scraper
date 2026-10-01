// Check whether saved jobs are still posted, e.g. to prune a tracker
import {
  configureCache,
  fetchJob,
  HttpError,
  JobNotFoundError,
  time,
} from '@chrisdothtml/job-scraper';

// a posting answered from a day-old cache could have closed since
configureCache({ ttl: time.hour });

export async function isStillOpen(url: string): Promise<boolean> {
  try {
    await fetchJob(url);
    return true;
  } catch (error) {
    // the board's list no longer has it
    if (error instanceof JobNotFoundError) return false;
    // or the board answers for it with a 404 (or a 410)
    if (error instanceof HttpError && [404, 410].includes(error.status)) {
      return false;
    }
    // anything else (a network error, a rate limit) isn't an answer
    throw error;
  }
}
