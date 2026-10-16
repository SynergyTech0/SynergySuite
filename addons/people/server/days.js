// Business days (Monday to Friday) between two dates, inclusive of both ends.
// Dates are compared in UTC, so pass plain YYYY-MM-DD strings.
function businessDays(start, end) {
  let d = new Date(start), n = 0;
  const e = new Date(end);
  while (d <= e) {
    const day = d.getUTCDay();
    if (day !== 0 && day !== 6) n++;
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return n;
}

module.exports = { businessDays };
