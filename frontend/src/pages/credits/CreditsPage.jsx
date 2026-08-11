import { Link } from "react-router-dom";
import AppNavbar from "../../components/AppNavbar";
import { CREDIT_CREATORS } from "./credits";

export default function CreditsPage() {
    return (
        <main className="home-grid min-h-screen bg-[#050d16] font-interface text-slate-100">
            <AppNavbar />

            <section className="relative z-[1] mx-auto flex min-h-[calc(100vh-72px)] w-full max-w-[720px] flex-col justify-center px-5 py-12 sm:px-8">
                <div className="rounded-2xl border border-cyan-900/80 bg-[#091521ed] p-6 shadow-[0_18px_60px_rgba(0,0,0,.24)] sm:p-9">
                    <p className="font-mono text-[11px] font-bold tracking-[.3em] text-cyan-400">PROJECT ACKNOWLEDGEMENTS</p>
                    <h1 className="mt-3 text-4xl font-bold tracking-tight text-white sm:text-5xl">Credits</h1>
                    <p className="mt-4 max-w-xl text-sm leading-6 text-slate-400 sm:text-base">
                        The following creators are credited for assets used by this project.
                    </p>

                    <ul className="mt-8 divide-y divide-slate-700/70 border-y border-slate-700/70">
                        {CREDIT_CREATORS.map((creator) => (
                            <li key={creator} className="py-4 text-base font-semibold text-slate-200 sm:text-lg">
                                {creator} on itch.io
                            </li>
                        ))}
                    </ul>

                    <Link to="/home" className="mt-8 inline-flex min-h-11 items-center border border-cyan-400/50 bg-cyan-950/30 px-5 py-2.5 text-sm font-bold text-cyan-200 hover:border-cyan-300">
                        Return home
                    </Link>
                </div>
            </section>
        </main>
    );
}
