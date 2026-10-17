"use client";
// What Devices is built on, and what it doesn't do yet.

export function About() {
  return (
    <div className="page">
      <div className="pagehead"><div><h1>About Synergy Devices</h1><p className="muted">Device management and endpoint security for the Synergy suite: the equivalent of Microsoft Intune and Defender for Endpoint.</p></div></div>
      <section className="panel">
        <h3>Built on</h3>
        <ul>
          <li><a className="link" href="https://osquery.io" target="_blank" rel="noreferrer">osquery</a>, the endpoint agent on each computer, by the osquery project at the Linux Foundation (Apache-2.0 / GPL-2.0). Devices is its server: it serves the schedule, receives results and sends live queries over osquery&apos;s TLS remote API. osquery is installed from its own releases and is not bundled or modified.</li>
          <li><a className="link" href="https://osv.dev" target="_blank" rel="noreferrer">OSV</a>, the open source vulnerability database, for advisories affecting installed Linux packages. Advisory data comes from each distribution&apos;s security team under its own terms.</li>
          <li><a className="link" href="https://github.com/micromdm/nanomdm" target="_blank" rel="noreferrer">NanoMDM</a> by the MicroMDM project (MIT) speaks the Apple MDM protocol to iPhones, iPads and Macs, and <a className="link" href="https://github.com/micromdm/scep" target="_blank" rel="noreferrer">micromdm/scep</a> (MIT) issues their identity certificates. Both run unmodified beside Devices.</li>
          <li>Android phones and tablets are managed through Google&apos;s <a className="link" href="https://developers.google.com/android/management" target="_blank" rel="noreferrer">Android Management API</a> and managed Google Play, with the organization&apos;s own Google Cloud service account. Phones need nothing installed beyond Android itself.</li>
          <li>Windows PCs are managed with the device management built into Windows 10 and 11. Devices implements Microsoft&apos;s published enrollment and management protocols (<a className="link" href="https://learn.microsoft.com/openspecs/windows_protocols/ms-mde2" target="_blank" rel="noreferrer">MS-MDE2</a> and OMA-DM) itself, and issues each PC&apos;s identity certificate with <a className="link" href="https://github.com/digitalbazaar/forge" target="_blank" rel="noreferrer">Forge</a> (BSD-3-Clause).</li>
          <li>Severity scores use the <a className="link" href="https://www.first.org/cvss/v3.1/specification-document" target="_blank" rel="noreferrer">CVSS v3.1</a> base formula published by FIRST.</li>
        </ul>
      </section>
      <section className="panel">
        <h3>What it does</h3>
        <ul>
          <li>Inventory of Windows, macOS and Linux computers: hardware, operating system, installed software and who signs in.</li>
          <li>Apple device management for iPhones, iPads and Macs: remote lock, erase, restart and shut down, configuration profiles (passcode, FileVault, firewall, updates, Wi-Fi, restrictions or your own), and App Store apps and Mac packages installed by admins or by people on their own devices.</li>
          <li>Android management: a work profile on personal phones or full management of company phones, remote lock, erase (or removing just the work profile) and restart, passcode, Wi-Fi and restriction settings, and Google Play apps installed by admins or by people on their own phones.</li>
          <li>Windows management: restart and reset (optionally keeping user files), password, BitLocker, firewall, update, Wi-Fi and camera settings, and MSI apps installed by admins or by people on their own PCs. PCs report BitLocker, firewall and antivirus status for compliance.</li>
          <li>Compliance policies for disk encryption, firewall, antivirus, screen lock, system protection, automatic updates, OS version, check-ins, administrators, vulnerabilities and open threats.</li>
          <li>Blocking sign-in to the suite while a person&apos;s device is non-compliant, turned on in Auth&apos;s admin console.</li>
          <li>Threat detections for new network listeners, persistence, programs running from temporary folders, deleted binaries, new SSH keys, new administrators, security settings turned off, and known-bad file hashes.</li>
          <li>Live queries across the fleet, alert triage with notes and an optional AI explanation through the suite&apos;s own model.</li>
          <li>Evidence for Synergy Trust (endpoint compliance and endpoint threats), suite search, and eDiscovery through the Admin center.</li>
        </ul>
      </section>
      <section className="panel">
        <h3>Not yet</h3>
        <p style={{ marginTop: 0 }}>Windows has no remote lock for PCs, and commands reach a PC at its next hourly check-in (there&apos;s no instant wake-up without Microsoft&apos;s push service); Windows identity certificates last five years and aren&apos;t renewed automatically yet. Automated Device Enrollment through Apple Business Manager and app licenses from it aren&apos;t supported yet; devices enroll with a profile. Retiring a computer stops it reporting; it doesn&apos;t uninstall osquery.</p>
      </section>
    </div>
  );
}
