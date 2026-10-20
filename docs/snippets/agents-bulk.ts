import {
  createScraper,
  renderScrapedPosting,
  resolveCompany,
} from '@chrisdothtml/job-scraper';

async function printMatchingJobs(companyName: string, titlePart: string) {
  const company = await resolveCompany(companyName);
  const scraper = createScraper(company);

  try {
    const listedJobs = await scraper.getJobsList();
    for (const listed of listedJobs) {
      if (!listed.title.toLowerCase().includes(titlePart.toLowerCase()))
        continue;

      const job = await scraper.getJob(listed.id);
      const rendered = renderScrapedPosting(
        { ...job, ...listed },
        { postingUrl: listed.url }
      );
      console.log(rendered.markdown);
    }
  } finally {
    scraper.dispose();
  }
}

await printMatchingJobs('Airbnb', 'engineer');
