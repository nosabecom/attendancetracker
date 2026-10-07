"use client";
import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
export default function ThemeToggle() {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const media = matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const preference = localStorage.getItem("rollcall-theme");
      const enabled = preference ? preference === "dark" : media.matches;
      document.documentElement.dataset.theme = enabled ? "dark" : "light";
      setDark(enabled);
    };
    apply();
    media.addEventListener("change", apply);
    window.addEventListener("storage", apply);
    return () => {
      media.removeEventListener("change", apply);
      window.removeEventListener("storage", apply);
    };
  }, []);
  function toggle() {
    const next = !dark;
    setDark(next);
    document.documentElement.dataset.theme = next ? "dark" : "light";
    localStorage.setItem("rollcall-theme", next ? "dark" : "light");
  }
  return (
    <button
      className="theme-toggle"
      aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
      onClick={toggle}
    >
      {dark ? <Sun size={17} /> : <Moon size={17} />}
      <span>{dark ? "Light mode" : "Dark mode"}</span>
    </button>
  );
}
