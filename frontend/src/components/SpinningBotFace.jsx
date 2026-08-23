import BotLogo from "./BotLogo.jsx";

export default function SpinningBotFace({ className = "h-10 w-10" }) {
    return (
        <span className={`asset-loading-bot ${className}`} aria-hidden="true">
            <BotLogo className="h-full w-full object-contain" />
        </span>
    );
}
