import { lazy, Suspense } from 'react'
import { BrowserRouter, Navigate, Routes, Route } from 'react-router-dom'
import { AuthProvider } from './auth/AuthContext'
import ActiveMatchProtectedRoute from './auth/ActiveMatchProtectedRoute'
import MatchProtectedRoute from './auth/MatchProtectedRoute.jsx'
import ProtectedRoute from './auth/ProtectedRoute'
import AdminRoute from './auth/AdminRoute.jsx'
import HomePage from './pages/home/HomePage'
import Arena from './gameArena/Arena'
import LoginPage from './pages/auth/LoginPage'
import RegisterPage from './pages/auth/RegisterPage'
import ServerErrorPage from './pages/ServerErrorPage.jsx'
import CreditsPage from './pages/credits/CreditsPage'
import VerifyEmailPage from './pages/auth/VerifyEmailPage'
import { loadAbilityCatalogue, loadConditionalCatalogue, loadMatch, loadProfile, loadProfileSearch, loadPuzzleBuilder, loadPuzzlePlay, loadPuzzles, loadTutorial } from './routeLoaders'
import MatchmakingProvider from './matchmaking/MatchmakingProvider'
import NotificationsProvider from './notifications/NotificationsProvider.jsx'
import ArenaLoadingScreen from './components/ArenaLoadingScreen'
import ArenaPresentationAssetsProvider from './gameArena/pixi/ArenaPresentationAssetsProvider.jsx'

const AbilityCataloguePage = lazy(loadAbilityCatalogue)
const ConditionalCataloguePage = lazy(loadConditionalCatalogue)
const GamePage = lazy(loadMatch)
const ProfilePage = lazy(loadProfile)
const ProfileSearchPage = lazy(loadProfileSearch)
const TutorialPage = lazy(loadTutorial)
const PuzzleListPage = lazy(loadPuzzles)
const PuzzlePlayPage = lazy(loadPuzzlePlay)
const PuzzleBuilderPage = lazy(loadPuzzleBuilder)

function App() {


  return (

    <BrowserRouter>
      <AuthProvider>
        <NotificationsProvider>
          <MatchmakingProvider>
            <ArenaPresentationAssetsProvider>
              <Suspense fallback={<ArenaLoadingScreen />}>
                <Routes>
            <Route path="/" element={<Navigate to="/login" replace />} />
            <Route path="/login" element={<LoginPage />} />
            <Route path="/register" element={<RegisterPage />} />
            <Route path="/verify-email" element={<VerifyEmailPage />} />
            <Route path="/error" element={<ServerErrorPage />} />
            <Route
              path="/home"
              element={(
                <ProtectedRoute>
                  <ActiveMatchProtectedRoute>
                    <HomePage />
                  </ActiveMatchProtectedRoute>
                </ProtectedRoute>
              )}
            />
            <Route
              path="/credits"
              element={<CreditsPage />}
            />
            <Route
              path="/practice"
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
              path="/puzzles"
              element={(
                <ProtectedRoute>
                  <PuzzleListPage />
                </ProtectedRoute>
              )}
            />
            <Route
              path="/puzzles/:puzzleNumber"
              element={(
                <ProtectedRoute>
                  <PuzzlePlayPage />
                </ProtectedRoute>
              )}
            />
            <Route
              path="/admin/puzzles/new"
              element={(
                <ProtectedRoute>
                  <AdminRoute>
                    <PuzzleBuilderPage />
                  </AdminRoute>
                </ProtectedRoute>
              )}
            />
            <Route
              path="/admin/puzzles/:puzzleNumber/edit"
              element={(
                <ProtectedRoute>
                  <AdminRoute>
                    <PuzzleBuilderPage />
                  </AdminRoute>
                </ProtectedRoute>
              )}
            />
            <Route
              path="/match"
              element={(
                <ProtectedRoute>
                  <MatchProtectedRoute>
                    <GamePage />
                  </MatchProtectedRoute>
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
            </ArenaPresentationAssetsProvider>
          </MatchmakingProvider>
        </NotificationsProvider>
      </AuthProvider>
    </BrowserRouter>
  )
}

export default App
