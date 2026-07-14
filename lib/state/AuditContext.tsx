"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { AuditResult, NavFilter } from "@/lib/types";

const STORAGE_KEY = "seo-audit-dashboard-state-v1";

interface PersistedState {
  results: AuditResult[];
  lastAuditDate: string | null;
  groqApiKey: string;
}

interface AuditContextValue {
  results: AuditResult[];
  lastAuditDate: string | null;
  selectedUrlIndex: number;
  navFilter: NavFilter | null;
  groqApiKey: string;
  addResult: (result: AuditResult) => void;
  setSelectedUrlIndex: (index: number) => void;
  setNavFilter: (filter: NavFilter | null) => void;
  setGroqApiKey: (key: string) => void;
  clearAll: () => void;
}

const AuditContext = createContext<AuditContextValue | null>(null);

function loadPersisted(): PersistedState {
  if (typeof window === "undefined") return { results: [], lastAuditDate: null, groqApiKey: "" };
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { results: [], lastAuditDate: null, groqApiKey: "" };
    const parsed = JSON.parse(raw);
    return {
      results: Array.isArray(parsed.results) ? parsed.results : [],
      lastAuditDate: parsed.lastAuditDate ?? null,
      groqApiKey: typeof parsed.groqApiKey === "string" ? parsed.groqApiKey : "",
    };
  } catch {
    return { results: [], lastAuditDate: null, groqApiKey: "" };
  }
}

export function AuditProvider({ children }: { children: ReactNode }) {
  const [results, setResults] = useState<AuditResult[]>([]);
  const [lastAuditDate, setLastAuditDate] = useState<string | null>(null);
  const [selectedUrlIndex, setSelectedUrlIndex] = useState(0);
  const [navFilter, setNavFilter] = useState<NavFilter | null>(null);
  const [groqApiKey, setGroqApiKey] = useState("");
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const persisted = loadPersisted();
    setResults(persisted.results);
    setLastAuditDate(persisted.lastAuditDate);
    setGroqApiKey(persisted.groqApiKey);
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated || typeof window === "undefined") return;
    const payload: PersistedState = { results, lastAuditDate, groqApiKey };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  }, [results, lastAuditDate, groqApiKey, hydrated]);

  const value = useMemo<AuditContextValue>(
    () => ({
      results,
      lastAuditDate,
      selectedUrlIndex,
      navFilter,
      groqApiKey,
      addResult: (result) => {
        setResults((prev) => {
          const existingIdx = prev.findIndex((r) => r.url === result.url);
          if (existingIdx >= 0) {
            const next = [...prev];
            next[existingIdx] = result;
            return next;
          }
          return [result, ...prev];
        });
        setLastAuditDate(new Date().toISOString());
        setSelectedUrlIndex(0);
      },
      setSelectedUrlIndex,
      setNavFilter,
      setGroqApiKey,
      clearAll: () => {
        setResults([]);
        setLastAuditDate(null);
        setSelectedUrlIndex(0);
        setNavFilter(null);
      },
    }),
    [results, lastAuditDate, selectedUrlIndex, navFilter, groqApiKey],
  );

  return <AuditContext.Provider value={value}>{children}</AuditContext.Provider>;
}

export function useAudit() {
  const ctx = useContext(AuditContext);
  if (!ctx) throw new Error("useAudit must be used within AuditProvider");
  return ctx;
}
