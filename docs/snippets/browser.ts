// In a frontend app, through any bundler. Same API as Node: the registry
// lives in localStorage, and board responses in the Cache API
import {
  configureCache,
  CorsError,
  listCompanyJobs,
  time,
  UnresolvedCompanyError,
  type ListedJob,
} from '@chrisdothtml/job-scraper';

configureCache({ ttl: time.hour });

export async function loadJobs(
  company: string
): Promise<ListedJob[] | 'blocked'> {
  try {
    return await listCompanyJobs(company);
  } catch (error) {
    // only some boards allow cross-origin requests. The rest work from Node,
    // so hand those off to your server
    if (error instanceof CorsError) return 'blocked';
    if (error instanceof UnresolvedCompanyError && error.blocked) {
      return 'blocked';
    }
    throw error;
  }
}
