#!/bin/sh
# Prints the failing and warning lines from the most recent failed
# "Scraper health" run, minus the log's job/timestamp noise. Lives in a file
# because skill-inline commands can't use command substitution, and `$N` in
# them is replaced with skill arguments.
run=$(gh run list --workflow scraper-health.yml --status failure -L 1 --json databaseId --jq '.[0].databaseId')
if [ -z "$run" ]; then
  echo "No failed runs found."
  exit 0
fi
echo "Run $run:"
gh run view "$run" --log \
  | grep -E "FAIL |WARN |boards OK|\(fail\)|error:" \
  | awk -F'\t' '{ sub(/^[^ ]+ /, "", $3); print $2 ": " substr($3, 1, 250) }'
