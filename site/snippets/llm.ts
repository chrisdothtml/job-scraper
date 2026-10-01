// Turn whatever job URL a user pastes into structured data for an LLM, a
// resume tailor, an application tracker, ...
import { fetchJob } from '@chrisdothtml/job-scraper';

export async function jobFromUrl(url: string) {
  // a board link, or the company's own careers page with a board embedded
  const job = await fetchJob(url);
  return {
    title: job.title,
    location: job.location,
    url: job.url,
    // whatever the board serves: usually JSON, sometimes markdown or plain
    // text. Models read any of them fine
    description: job.content,
  };
}

const job = await jobFromUrl(
  'https://careers.airbnb.com/positions/8184174?gh_jid=8184174'
);
const prompt = `Tailor my resume to this posting:\n\n${JSON.stringify(job)}`;
