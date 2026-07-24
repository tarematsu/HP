const command = process.argv.slice(2).join(' ') || 'remote operation';

throw new Error(
  `Standalone VideoScraper ${command} is retired. `
  + 'Deploy and migrate the unified runtime from the cloud workspace.'
);
