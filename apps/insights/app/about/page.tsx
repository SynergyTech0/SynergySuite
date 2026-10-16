import Link from "next/link";
import { metabase } from "@/lib/metabase";

export const dynamic = "force-dynamic";

export default async function About() {
  const version = await metabase().version();
  return (
    <div className="page">
      <div className="head">
        <Link className="crumb" href="/">Insights</Link>
        <span className="muted">/</span>
        <h1 className="grow">About</h1>
      </div>
      <div className="panel">
        <h2>Synergy Insights</h2>
        <p>
          Dashboards and reports over your business data, part of Synergy Suite. Insights connects Books, CRM, Desk,
          Base and the suite&apos;s other business apps as read-only data sources, signs you in with your suite account
          and shows the dashboards you can open.
        </p>
        <h2>Built on Metabase</h2>
        <p>
          The report designer and the charts are{" "}
          <a href="https://www.metabase.com" target="_blank" rel="noreferrer">Metabase</a>, the open source business
          intelligence tool, used unmodified under the{" "}
          <a href="https://github.com/metabase/metabase/blob/master/LICENSE.txt" target="_blank" rel="noreferrer">
            GNU Affero General Public License v3
          </a>
          . Its source code is at{" "}
          <a href="https://github.com/metabase/metabase" target="_blank" rel="noreferrer">github.com/metabase/metabase</a>.
          Metabase is a trademark of Metabase, Inc.; Synergy Suite is not affiliated with or endorsed by Metabase, Inc.
        </p>
        <p className="muted small">{version ? `Metabase ${version}` : "The reporting engine isn't answering right now."}</p>
        <h2>License</h2>
        <p>
          Synergy Suite is free software under the GNU Affero General Public License v3. Source:{" "}
          <a href="https://github.com/SynergyTech0/SynergySuite" target="_blank" rel="noreferrer">
            github.com/SynergyTech0/SynergySuite
          </a>
          .
        </p>
      </div>
    </div>
  );
}
