import { lazy, Suspense } from 'react'
import { BrowserRouter, Navigate, Routes, Route } from 'react-router-dom'
import { AuthProvider } from './auth/AuthContext'
import ProtectedRoute from './auth/ProtectedRoute'
import HomePage from './pages/HomePage'
import LoginPage from './pages/LoginPage'
import RegisterPage from './pages/RegisterPage'
import { loadAbilityCatalogue, loadBotRoom, loadConditionalCatalogue, loadMatchmaking, loadProfile } from './routeLoaders'
import MatchmakingProvider from './matchmaking/MatchmakingProvider'
import ArenaLoadingScreen from './components/ArenaLoadingScreen'
import './App.css'

const BetaModel = lazy(loadBotRoom)
const AbilityCataloguePage = lazy(loadAbilityCatalogue)
const ConditionalCataloguePage = lazy(loadConditionalCatalogue)
const MatchmakingPage = lazy(loadMatchmaking)
const ProfilePage = lazy(loadProfile)
const TutorialPage = lazy(() => import('./tutorial/TutorialPage'))

function App() {


  return (

    <BrowserRouter>
      <AuthProvider>
        <MatchmakingProvider>
          <Suspense fallback={<ArenaLoadingScreen />}>
            <Routes>
            <Route path="/" element={<Navigate to="/login" replace />} />
            <Route path="/login" element={<LoginPage />} />
            <Route path="/register" element={<RegisterPage />} />
            <Route
              path="/home"
              element={(
                <ProtectedRoute>
                  <HomePage />
                </ProtectedRoute>
              )}
            />
            <Route
              path="/beta"
              element={(
                <ProtectedRoute>
                  <BetaModel />
                </ProtectedRoute>
              )}
            />
            <Route
              path="/ability-catalogue"
              element={(
                <ProtectedRoute>
                  <AbilityCataloguePage />
                </ProtectedRoute>
              )}
            />
            <Route
              path="/conditionals"
              element={(
                <ProtectedRoute>
                  <ConditionalCataloguePage />
                </ProtectedRoute>
              )}
            />
            <Route
              path="/tutorial"
              element={(
                <ProtectedRoute>
                  <TutorialPage />
                </ProtectedRoute>
              )}
            />
            <Route
              path="/matchmaking"
              element={(
                <ProtectedRoute>
                  <MatchmakingPage />
                </ProtectedRoute>
              )}
            />
            <Route
              path="/profile"
              element={(
                <ProtectedRoute>
                  <ProfilePage />
                </ProtectedRoute>
              )}
            />
            </Routes>
          </Suspense>
        </MatchmakingProvider>
      </AuthProvider>
    </BrowserRouter>
  )
}

export default App
