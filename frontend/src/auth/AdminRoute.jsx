import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "./auth-context";
import ArenaLoadingScreen from "../components/ArenaLoadingScreen.jsx";

export default function AdminRoute({ children }) {
    const { user, isLoading, isAuthenticated } = useAuth();
    const location = useLocation();

    if (isLoading) return <ArenaLoadingScreen />;
    if (!isAuthenticated) return <Navigate to="/login" replace state={{ from: location }} />;
    if (!user?.admin) return <Navigate to="/home" replace />;
    return children;
}
