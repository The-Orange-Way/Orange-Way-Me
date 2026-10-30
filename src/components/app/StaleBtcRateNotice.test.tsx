import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { StaleBtcRateNotice } from "./StaleBtcRateNotice";

describe("StaleBtcRateNotice", () => {
  it("says prices are out of date and names the day of the last update", () => {
    const bucketTs = "2026-09-24T19:23:00Z";
    const label = new Date(bucketTs).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
    const html = renderToStaticMarkup(<StaleBtcRateNotice bucketTs={bucketTs} />);
    expect(html).toContain('role="status"');
    expect(html).toContain("Bitcoin prices are out of date");
    expect(html).toContain(`(last update ${label})`);
    expect(html).toContain("may be wrong");
  });

  it("still warns, without a date, when there is no bucket time", () => {
    const html = renderToStaticMarkup(<StaleBtcRateNotice bucketTs={null} />);
    expect(html).toContain("Bitcoin prices are out of date.");
    expect(html).not.toContain("last update");
  });

  it("treats an unparseable bucket time like a missing one", () => {
    const html = renderToStaticMarkup(<StaleBtcRateNotice bucketTs="not-a-date" />);
    expect(html).toContain("Bitcoin prices are out of date.");
    expect(html).not.toContain("last update");
    expect(html).not.toContain("Invalid Date");
  });
});
