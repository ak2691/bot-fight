import { useState } from "react";
import botDesignUrl from "../assets/arena/abilities/bot/bot-design.png";

export default function BotLogo({ className = "h-full w-full object-contain", showLabel = false }) {
    const [imageFailed, setImageFailed] = useState(false);

    if (imageFailed) {
        return <span aria-hidden="true">BF</span>;
    }

    return <><img src={botDesignUrl} alt="" className={className} onError={() => setImageFailed(true)} />{showLabel && <span>BF</span>}</>;
}
