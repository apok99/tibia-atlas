import { lazy } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { Layout } from './components/Layout'
// Home page is disabled — the interactive map is now the site's landing page.
// import { HomePage } from './pages/HomePage'

// Every non-home page is code-split: heavy libraries (recharts, leaflet,
// globe.gl/three) only download when a route that uses them is visited.
const BrowsePage = lazy(() => import('./pages/BrowsePage').then((m) => ({ default: m.BrowsePage })))
const EntryPage = lazy(() => import('./pages/EntryPage').then((m) => ({ default: m.EntryPage })))
const SoundtrackPage = lazy(() => import('./pages/SoundtrackPage').then((m) => ({ default: m.SoundtrackPage })))
const MapPage = lazy(() => import('./pages/MapPage').then((m) => ({ default: m.MapPage })))
const KillStatsPage = lazy(() => import('./pages/KillStatsPage').then((m) => ({ default: m.KillStatsPage })))
const ItemsPage = lazy(() => import('./pages/ItemsPage').then((m) => ({ default: m.ItemsPage })))
const ItemDetailPage = lazy(() => import('./pages/ItemDetailPage').then((m) => ({ default: m.ItemDetailPage })))
const WordlePage = lazy(() => import('./pages/WordlePage').then((m) => ({ default: m.WordlePage })))
const AltarPage = lazy(() => import('./pages/AltarPage').then((m) => ({ default: m.AltarPage })))
const GeoPage = lazy(() => import('./pages/GeoPage').then((m) => ({ default: m.GeoPage })))
const IdlePage = lazy(() => import('./pages/IdlePage').then((m) => ({ default: m.IdlePage })))
const AboutPage = lazy(() => import('./pages/AboutPage').then((m) => ({ default: m.AboutPage })))

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          {/* The map is the landing page (home is commented out above). */}
          <Route index element={<MapPage />} />
          <Route path="browse" element={<BrowsePage />} />
          {/* NPC, city and character listings were retired — send old links home. */}
          <Route path="browse/npc" element={<Navigate to="/" replace />} />
          <Route path="browse/city" element={<Navigate to="/" replace />} />
          <Route path="browse/character" element={<Navigate to="/" replace />} />
          <Route path="browse/:type" element={<BrowsePage />} />
          <Route path="items" element={<ItemsPage />} />
          <Route path="items/:slug" element={<ItemDetailPage />} />
          <Route path="wordle" element={<WordlePage />} />
          <Route path="altar" element={<AltarPage />} />
          <Route path="geo" element={<GeoPage />} />
          <Route path="idle" element={<IdlePage />} />
          <Route path="entry/:slug" element={<EntryPage />} />
          <Route path="map" element={<MapPage />} />
          <Route path="killstats" element={<KillStatsPage />} />
          <Route path="soundtrack" element={<SoundtrackPage />} />
          <Route path="about" element={<AboutPage />} />
          {/* Retired routes (library, quests, …) and any unknown path fall home. */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
