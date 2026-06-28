export type Track = {
  id: number
  /** Display title, cleaned from the original filename. */
  title: string
  /** URL-encoded path under /public so it can be fetched directly. */
  src: string
}

/**
 * The official Tibia soundtrack, served as static files from /public/soundtrack.
 * Titles are derived from the original CipSoft file names.
 */
const FILES = [
  "TIBIA_Anthem.ogg",
  "TIBIA_01_Ab'Dendriel.ogg",
  'TIBIA_02_Carlin.ogg',
  'TIBIA_03_Darama.ogg',
  'TIBIA_04_Edron.ogg',
  'TIBIA_05_Zao_Secluded_Island.ogg',
  'TIBIA_06_Feyrist.ogg',
  'TIBIA_07_Quirefang_and_More.ogg',
  'TIBIA_08_Kazordoon.ogg',
  'TIBIA_09_Oramond_(Rathleton).ogg',
  'TIBIA_10_Tiquanda.ogg',
  'TIBIA_11_Hrodmir_(Svargrond).ogg',
  'TIBIA_12_Thais.ogg',
  'TIBIA_13_Thais_City.ogg',
  'TIBIA_14_King_Tibianus_Queen_Eloise_Emperor_Kruzak.ogg',
  'TIBIA_15_Venore.ogg',
  'TIBIA_16_Yalahar.ogg',
  'TIBIA_17_Special_Boss_Lairs.ogg',
  'TIBIA_18_Kilmaresh.ogg',
  'TIBIA_19_Dawnport_Rookgaard.ogg',
  'TIBIA_20_Marapur.ogg',
  'TIBIA_21_Podzillas_Biosphere.ogg',
]

function prettyTitle(file: string): string {
  return file
    .replace(/\.ogg$/i, '')
    .replace(/^TIBIA_/, '')
    .replace(/^\d+_/, '')
    .replace(/_/g, ' ')
    .trim()
}

export const TRACKS: Track[] = FILES.map((file, i) => ({
  id: i,
  title: prettyTitle(file),
  src: `/soundtrack/${encodeURIComponent(file)}`,
}))
