#!/bin/bash
# يشغّل السكربت مرة وحدة بس (يمنع التداخل لو تشغيلة سابقة لسا شغالة)
set -e
cd /root/jobs-scraper

exec flock -n /tmp/jobs-scraper.lock /usr/bin/node jobs-scraper-fixed.js
