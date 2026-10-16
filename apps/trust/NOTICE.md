# Third-party standards content — licensing position

This matters commercially, not just legally: it constrains what the shipped catalog may
contain, and it is the kind of thing a prospect's counsel asks about during diligence.

## The split

| Framework | Status of the source text | What we may ship |
|---|---|---|
| **HIPAA** (45 CFR 164) | U.S. federal regulation — public domain | Verbatim text is fine |
| **GDPR** (EU 2016/679) | EU legislation, reproducible under Decision 2011/833/EU with attribution | Verbatim text is fine with source acknowledged |
| **SOC 2 / Trust Services Criteria** | © AICPA. Copyrighted; redistribution requires a licence | **Paraphrase only** |
| **ISO/IEC 27001:2022** | © ISO/IEC. Sold per-copy; redistribution prohibited | **Paraphrase only; no Annex A control text** |

## What this codebase does

`db/catalog/soc2.json` and `db/catalog/iso27001.json` contain **our own paraphrases** of each
criterion and control, written to be operationally useful while not reproducing the
standards' protected expression. Short control *titles* are reproduced because they function
as identifiers rather than expressive content, and users must be able to match our records to
their own copy of the standard.

`db/catalog/hipaa.json` and `db/catalog/gdpr.json` track the statutory language closely,
which those sources permit.

## Consequences for the product

1. **Every tenant-facing view of a SOC 2 or ISO requirement must be labelled as a
   paraphrase**, with a pointer to the authoritative source. Presenting our wording as the
   standard's would be both a licensing problem and a correctness problem — an auditor tests
   against the real text.
2. **ISO 27001 certification requires the customer to hold the standard.** We should say so
   rather than implying our catalog substitutes for it.
3. **If verbatim text is ever wanted**, it needs a licence: AICPA for the TSC, and ISO (or a
   national member body such as ANSI/BSI) for 27001. Several competitors hold these. Worth
   pricing before it becomes a sales objection.
4. **Do not display a SOC 2, ISO 27001, HIPAA or GDPR badge, seal, or logo** for the
   organisation running this instance or for any tenant on the basis of data in this system. This tool measures readiness. Only an
   accredited certification body issues an ISO certificate, and only a licensed CPA firm
   issues a SOC 2 report. A readiness score is not an attestation, and rendering it as one is
   a mistake that is expensive to unwind once a customer has relied on it.

## Attribution

GDPR text derives from Regulation (EU) 2016/679, © European Union,
<https://eur-lex.europa.eu>. HIPAA text derives from 45 CFR Parts 160 and 164.
