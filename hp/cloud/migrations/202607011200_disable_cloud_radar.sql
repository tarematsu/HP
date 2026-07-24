DELETE FROM job_runs WHERE job_name = 'radar';
DELETE FROM jobs WHERE name = 'radar';
DELETE FROM current_state WHERE source = 'radar';
