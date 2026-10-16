import { studioLink } from "@/lib/api";

export const dynamic = "force-dynamic";

export default function About() {
  const engineVersion = process.env.FLOW_ENGINE_VERSION || "";
  return (
    <div className="page narrow">
      <p>
        <a href="/">← Back to Flow</a>
      </p>
      <h1>About Synergy Flow</h1>
      <p>
        Synergy Flow automates work across the suite and outside services: when something happens in one app, a flow does something in
        another. It is the suite&apos;s answer to Microsoft Power Automate.
      </p>

      <h2>Built on Activepieces</h2>
      <p>
        Flows are designed and run by the open source{" "}
        <a href="https://www.activepieces.com" rel="noreferrer">
          Activepieces
        </a>{" "}
        engine (Community Edition{engineVersion ? `, ${engineVersion}` : ""}), released by Activepieces Inc. under the MIT license. The flow
        designer you open from Flow is Activepieces&apos; own, unchanged, so it carries its name. Its source code is at{" "}
        <a href="https://github.com/activepieces/activepieces" rel="noreferrer">
          github.com/activepieces/activepieces
        </a>
        . Thank you to the Activepieces team and its contributors.
      </p>
      <p>
        Synergy Flow only uses the engine&apos;s MIT-licensed community edition. The Synergy steps (Mail, Calendar, To Do, Planner, Chat, Forms,
        Contacts, Drive, Desk and CRM) are a Synergy piece, licensed AGPL-3.0 with the rest of the suite; it bundles the Activepieces piece
        framework (MIT) and the third-party packages listed in its notices file.
      </p>

      <h2>How your flows reach the suite</h2>
      <p>
        Each person has their own flows in their own space in the engine. Synergy steps act as you: they call each app the way your browser
        would, so a flow can open, send or change only what you could yourself. The first time you open the designer, Flow adds a
        &quot;Synergy&quot; connection for you; you never type a password.
      </p>
      <p>
        <a className="btn" href={studioLink("/")}>
          Open the designer
        </a>
      </p>
    </div>
  );
}
