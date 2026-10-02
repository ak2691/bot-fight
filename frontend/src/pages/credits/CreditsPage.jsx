import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../../auth/auth-context";
import AppNavbar from "../../components/AppNavbar";
import { CREDIT_CREATORS } from "./credits";
import "./credits.css";

export default function CreditsPage() {
    const navigate = useNavigate();
    const location = useLocation();
    const { isAuthenticated, isGuest } = useAuth();
    // Signed-in users (including guests) get the full navbar; signed-out visitors get the wordmark and a Log in button.
    const signedIn = isAuthenticated || isGuest;
    const fallbackPath = signedIn ? "/home" : "/login";

    const goBack = (event) => {
        // location.key is "default" when this page was opened directly, so there is nothing to go back to.
        if (location.key === "default") return;
        event.preventDefault();
        navigate(-1);
    };

    return (
        <main className="credits-page min-h-screen font-interface text-slate-100">
            {signedIn ? (
                <AppNavbar account currentPage="credits" />
            ) : (
                <AppNavbar onHome={() => navigate("/login")}>
                    <Link to="/login" className="app-navbar-control nb-login">Log in</Link>
                </AppNavbar>
            )}

            <section className="credits-content">
                <h1 className="credits-title">Credits</h1>
                <p className="credits-subtitle">Thanks to these creators, whose assets are used in Bot Fight.</p>

                <ul className="credits-grid">
                    {CREDIT_CREATORS.map((creator) => (
                        <li key={creator} className="credits-item">
                            <span className="credits-item__name">{creator}</span>
                            <span className="credits-tag">itch.io</span>
                        </li>
                    ))}
                </ul>

                <Link to={fallbackPath} onClick={goBack} className="credits-back">← Back</Link>
            </section>
        </main>
    );
}
