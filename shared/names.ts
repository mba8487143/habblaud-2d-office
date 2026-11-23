import { hash32 } from './hash';

export interface PersonName {
  name: string;
  look: 'f' | 'm';
}

// Duas listas de nomes, cada uma sem duplicatas e sem variações quase iguais (ex.: Thiago/Tiago, Hira/Hina), para que
// cada personagem seja inconfundível:
// - os do escritório (OFFICE_NAME_POOL, pickOfficeName): nomes paquistaneses, os que aparecem nos personagens daqui;
// - os do Habblaud World (NAME_POOL, pickName): os nomes brasileiros originais. O servidor do mundo confere cada nome
//   do pacote do prédio contra a cópia dele desta lista (docs/world/privacidade.md), então ela não muda.

/** Nomes paquistaneses para os personagens do escritório. */
const OFFICE_F = [
  'Ayesha', 'Fatima', 'Zainab', 'Maryam', 'Hira', 'Sana', 'Amna', 'Mahnoor', 'Iqra', 'Rabia',
  'Nimra', 'Areeba', 'Hania', 'Mehwish', 'Sadia', 'Kiran', 'Noor', 'Anaya', 'Alina', 'Laiba',
  'Eman', 'Hafsa', 'Khadija', 'Rida', 'Sidra', 'Bushra', 'Farah', 'Huma', 'Javeria', 'Mehak',
  'Rimsha', 'Sumbul', 'Tooba', 'Uzma', 'Warda', 'Zara', 'Zoya', 'Anum', 'Bisma', 'Dua',
  'Fiza', 'Ghazal', 'Iram', 'Komal', 'Lubna', 'Madiha', 'Naila', 'Palwasha', 'Rubab', 'Saima',
  'Shiza', 'Tahira', 'Urooj', 'Yusra', 'Zunaira', 'Kinza', 'Hareem', 'Minahil', 'Nayab', 'Shazia',
];
const OFFICE_M = [
  'Ali', 'Ahmed', 'Bilal', 'Hamza', 'Usman', 'Umar', 'Hassan', 'Hussain', 'Faisal', 'Imran',
  'Kamran', 'Saad', 'Danish', 'Fahad', 'Junaid', 'Asad', 'Farhan', 'Haris', 'Ibrahim', 'Jawad',
  'Kashif', 'Mohsin', 'Nabeel', 'Owais', 'Qasim', 'Rizwan', 'Salman', 'Shahid', 'Tariq', 'Waqas',
  'Yasir', 'Zubair', 'Adnan', 'Babar', 'Sohail', 'Ehsan', 'Faraz', 'Arsalan', 'Haider', 'Irfan',
  'Javed', 'Khalid', 'Moiz', 'Naveed', 'Rehan', 'Sami', 'Talha', 'Waleed', 'Yahya', 'Zeeshan',
  'Aamir', 'Fawad', 'Shoaib', 'Mustafa', 'Raza', 'Shehzad', 'Taimoor', 'Uzair', 'Wahab', 'Atif',
];

/** Nomes brasileiros originais: a lista que o Habblaud World conhece. */
const F = [
  'Ana', 'Beatriz', 'Camila', 'Daniela', 'Eduarda', 'Fernanda', 'Gabriela', 'Helena', 'Isabela', 'Júlia',
  'Larissa', 'Mariana', 'Natália', 'Olívia', 'Paula', 'Rebeca', 'Sofia', 'Tatiana', 'Valentina', 'Yasmin',
  'Alice', 'Bianca', 'Cecília', 'Débora', 'Elisa', 'Flávia', 'Giovana', 'Heloísa', 'Iara', 'Jéssica',
  'Lívia', 'Manuela', 'Melissa', 'Nina', 'Priscila', 'Rafaela', 'Sabrina', 'Teresa', 'Vitória', 'Zoe',
  'Aline', 'Bruna', 'Clara', 'Estela', 'Fabiana', 'Glória', 'Ingrid', 'Joana', 'Kátia', 'Lara',
  'Maitê', 'Mirela', 'Noemi', 'Pietra', 'Renata', 'Simone', 'Sara', 'Vanessa', 'Luana', 'Marina',
];
const M = [
  'Arthur', 'Bruno', 'Caio', 'Diego', 'Enzo', 'Felipe', 'Gustavo', 'Henrique', 'Igor', 'João',
  'Kauã', 'Lucas', 'Mateus', 'Nicolas', 'Otávio', 'Pedro', 'Rafael', 'Samuel', 'Thiago', 'Vinícius',
  'Bernardo', 'Danilo', 'Davi', 'Emanuel', 'Fábio', 'Gael', 'Heitor', 'Hugo', 'Joaquim', 'Jorge',
  'Leonardo', 'Lorenzo', 'Luan', 'Marcelo', 'Murilo', 'Noah', 'Otto', 'Raul', 'Renato', 'Ricardo',
  'Rodrigo', 'Sérgio', 'Theo', 'Tomás', 'Ulisses', 'Vicente', 'Wagner', 'Yuri', 'Augusto', 'Benício',
  'César', 'Douglas', 'Elias', 'Francisco', 'Guilherme', 'Ícaro', 'Jonas', 'Leandro', 'Miguel', 'Paulo',
];

/** Intercala para que nomes vizinhos no pool alternem a dica visual. */
function interleave(f: readonly string[], m: readonly string[]): readonly PersonName[] {
  return Object.freeze(f.flatMap((name, i) => [{ name, look: 'f' as const }, ...(m[i] ? [{ name: m[i], look: 'm' as const }] : [])]));
}

/** Os nomes dos personagens do escritório (paquistaneses). */
export const OFFICE_NAME_POOL: readonly PersonName[] = interleave(OFFICE_F, OFFICE_M);

/** Os nomes do Habblaud World (brasileiros): não mudar, o servidor do mundo confere o pacote contra esta lista. */
export const NAME_POOL: readonly PersonName[] = interleave(F, M);

/**
 * Escolhe um nome determinístico do `pool` para `id`, evitando os já usados.
 * Se o pool esgotar, acrescenta um sufixo numérico ("Ana 2").
 */
function pickFrom(pool: readonly PersonName[], id: string, used: ReadonlySet<string>): PersonName {
  const n = pool.length;
  const start = hash32(id) % n;
  for (let i = 0; i < n; i++) {
    const cand = pool[(start + i) % n];
    if (!used.has(cand.name)) return cand;
  }
  const base = pool[start];
  for (let k = 2; ; k++) {
    const name = `${base.name} ${k}`;
    if (!used.has(name)) return { name, look: base.look };
  }
}

/** Nome de um personagem do escritório (sessão, subagente ou agente do modo demonstração). */
export function pickOfficeName(id: string, used: ReadonlySet<string>): PersonName {
  return pickFrom(OFFICE_NAME_POOL, id, used);
}

/** Nome do Habblaud World (shared/world/projection.ts): sempre da lista brasileira que o servidor do mundo conhece. */
export function pickName(id: string, used: ReadonlySet<string>): PersonName {
  return pickFrom(NAME_POOL, id, used);
}
