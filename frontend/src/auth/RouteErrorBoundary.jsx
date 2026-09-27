import { Component } from "react";
import { useLocation } from "react-router-dom";
import FatalRecoveryScreen from "../components/FatalRecoveryScreen.jsx";
import { fatalPageMessage } from "./fatalRecovery.js";

class RouteBoundary extends Component {
    state = { error: null };

    static getDerivedStateFromError(error) {
        return { error };
    }

    render() {
        if (this.state.error) {
            return (
                <FatalRecoveryScreen
                    title="This page could not be loaded"
                    message={fatalPageMessage(this.state.error)}
                />
            );
        }
        return this.props.children;
    }
}

export default function RouteErrorBoundary({ children }) {
    const location = useLocation();
    return <RouteBoundary key={`${location.pathname}:${location.key}`}>{children}</RouteBoundary>;
}
