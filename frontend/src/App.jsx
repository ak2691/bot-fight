import { lazy, Suspense } from 'react'
import { BrowserRouter, Navigate, Routes, Route } from 'react-router-dom'
import { AuthProvider } from './auth/AuthContext'
import ProtectedRoute from './auth/ProtectedRoute'
import HomePage from './pages/home/HomePage'
import LoginPage from './pages/auth/LoginPage'
import RegisterPage from './pages/auth/RegisterPage'
import CreditsPage from './pages/credits/CreditsPage'
import VerifyEmailPage from './pages/auth/VerifyEmailPage'
import { loadAbilityCatalogue, loadAbilityTesting, loadAbilityTestingReplay, loadGameArena, loadConditionalCatalogue, loadMatchmaking, loadProfile, loadProfileSearch } from './routeLoaders'
import MatchmakingProvider from './matchmaking/MatchmakingProvider'
import ArenaLoadingScreen from './components/ArenaLoadingScreen'
import './App.css'

const Arena = lazy(loadGameArena)
const AbilityCataloguePage = lazy(loadAbilityCatalogue)
const AbilityTestingPage = lazy(loadAbilityTesting)
const AbilityTestingReplayPage = lazy(loadAbilityTestingReplay)
const ConditionalCataloguePage = lazy(loadConditionalCatalogue)
const GamePage = lazy(loadMatchmaking)
const ProfilePage = lazy(loadProfile)
const ProfileSearchPage = lazy(loadProfileSearch)
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
            <Route path="/verify-email" element={<VerifyEmailPage />} />
            <Route
              path="/home"
              element={(
                <ProtectedRoute>
                  <HomePage />
                </ProtectedRoute>
              )}
            />
            <Route
              path="/credits"
              element={<CreditsPage />}
            />
            <Route
              path="/beta"
              element={(
                <ProtectedRoute>
                  <Arena />
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
              path="/ability-testing"
              element={(
                <ProtectedRoute>
                  <AbilityTestingPage />
                </ProtectedRoute>
              )}
            />
            <Route
              path="/ability-testing/replay"
              element={(
                <ProtectedRoute>
                  <AbilityTestingReplayPage />
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
                  <GamePage />
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
            <Route
              path="/profile/search"
              element={(
                <ProtectedRoute>
                  <ProfileSearchPage />
                </ProtectedRoute>
              )}
            />
            <Route
              path="/profile/:username"
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
