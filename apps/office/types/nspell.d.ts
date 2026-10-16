// nspell ships without types; the parts Slides uses.
declare module "nspell" {
  type NSpell = { correct(word: string): boolean; suggest(word: string): string[]; add(word: string): NSpell; spell(word: string): { correct: boolean; forbidden: boolean; warn: boolean } };
  export default function nspell(aff: string | Uint8Array, dic?: string | Uint8Array): NSpell;
}
