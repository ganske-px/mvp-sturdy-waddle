export const RELATIONSHIP_LABELS: Record<string, string> = {
  MOTHER: 'Mãe',
  FATHER: 'Pai',
  PARENT: 'Pai/Mãe',
  GRANDPARENT: 'Avô/Avó',
  GRANDCHILD: 'Neto(a)',
  SON: 'Filho',
  DAUGHTER: 'Filha',
  CHILD: 'Filho(a)',
  SIBLING: 'Irmão/Irmã',
  BROTHER: 'Irmão',
  SISTER: 'Irmã',
  UNCLE: 'Tio/Tia',
  AUNT: 'Tia',
  NEPHEW: 'Sobrinho(a)',
  NIECE: 'Sobrinho(a)',
  COUSIN: 'Primo(a)',
  SPOUSE: 'Cônjuge',
  PARTNER: 'Companheiro(a)',
  IN_LAW: 'Parente por afinidade',
};

export function relationshipLabel(tipo?: string): string {
  if (!tipo) return 'Vínculo familiar';
  return RELATIONSHIP_LABELS[tipo] ?? 'Vínculo familiar';
}

const FIRST_DEGREE = new Set([
  'MOTHER',
  'FATHER',
  'PARENT',
  'SPOUSE',
  'PARTNER',
  'SON',
  'DAUGHTER',
  'CHILD',
]);

/** Parentes do núcleo próximo, exibidos no hero de identidade. */
export function isFirstDegree(tipo?: string): boolean {
  return !!tipo && FIRST_DEGREE.has(tipo);
}
