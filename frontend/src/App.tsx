import { lazy } from 'react'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { Layout } from './components/Layout'
import { HomePage } from './pages/HomePage'

// Every non-home page is code-split: heavy libraries (recharts, leaflet,
// globe.gl/three) only download when a route that uses them is visited.
const BrowsePage = lazy(() => import('./pages/BrowsePage').then((m) => ({ default: m.BrowsePage })))
const EntryPage = lazy(() => import('./pages/EntryPage').then((m) => ({ default: m.EntryPage })))
const HistoryPage = lazy(() => import('./pages/HistoryPage').then((m) => ({ default: m.HistoryPage })))
const SoundtrackPage = lazy(() => import('./pages/SoundtrackPage').then((m) => ({ default: m.SoundtrackPage })))
const MapPage = lazy(() => import('./pages/MapPage').then((m) => ({ default: m.MapPage })))
const KillStatsPage = lazy(() => import('./pages/KillStatsPage').then((m) => ({ default: m.KillStatsPage })))
const QuestsPage = lazy(() => import('./pages/QuestsPage').then((m) => ({ default: m.QuestsPage })))
const TimelinePage = lazy(() => import('./pages/TimelinePage').then((m) => ({ default: m.TimelinePage })))
const ItemsPage = lazy(() => import('./pages/ItemsPage').then((m) => ({ default: m.ItemsPage })))
const ItemDetailPage = lazy(() => import('./pages/ItemDetailPage').then((m) => ({ default: m.ItemDetailPage })))
const WordlePage = lazy(() => import('./pages/WordlePage').then((m) => ({ default: m.WordlePage })))

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<HomePage />} />
          <Route path="browse" element={<BrowsePage />} />
          <Route path="browse/:type" element={<BrowsePage />} />
          <Route path="quests" element={<QuestsPage />} />
          <Route path="items" element={<ItemsPage />} />
          <Route path="items/:slug" element={<ItemDetailPage />} />
          <Route path="wordle" element={<WordlePage />} />
          <Route path="entry/:slug" element={<EntryPage />} />
          <Route path="history" element={<HistoryPage />} />
          <Route path="map" element={<MapPage />} />
          <Route path="killstats" element={<KillStatsPage />} />
          <Route path="soundtrack" element={<SoundtrackPage />} />
          <Route path="timeline" element={<TimelinePage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
