// A self-contained example: replace this synthetic job with await fetchJob(url).
import { renderScrapedPosting, type Job } from '@chrisdothtml/job-scraper';

const job: Job = {
  id: 'example-1',
  title: 'Software Engineer',
  location: 'Remote',
  url: 'https://example.com/apply/example-1',
  content: JSON.stringify({
    company_name: 'Example Company',
    description: '<h2>About the role</h2><p>Build useful software.</p>',
    benefits: ['Flexible hours'],
    application_questions: [],
  }),
};

const complete = renderScrapedPosting(job); // mode: 'complete' by default
const compact = renderScrapedPosting(job, {
  mode: 'compact',
  postingUrl: 'https://example.com/jobs/example-1',
});

console.log(complete.markdown); // readable posting plus all parsed source fields
console.log(compact.body); // selected, deduplicated posting prose
console.log(complete.raw.content === job.content); // true: exact source retained
