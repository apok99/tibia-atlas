import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { Layout } from './components/Layout'
import { HomePage } from './pages/HomePage'
import { BrowsePage } from './pages/BrowsePage'
import { EntryPage } from './pages/EntryPage'
import { HistoryPage } from './pages/HistoryPage'
import { SoundtrackPage } from './pages/SoundtrackPage'
import { MapPage } from './pages/MapPage'
import { KillStatsPage } from './pages/KillStatsPage'
import { QuestsPage } from './pages/QuestsPage'
import { TimelinePage } from './pages/TimelinePage'
import { ItemsPage } from './pages/ItemsPage'
import { ItemDetailPage } from './pages/ItemDetailPage'
import { WordlePage } from './pages/WordlePage'

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
