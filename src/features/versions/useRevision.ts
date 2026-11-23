import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import type { Project } from "../../../shared/model";

export type RevisionMeta = {
    n: number;
    hash: string;
    workflowId: string;
    appliedAt: string;
    sectionIds?: string[]; // sections that changed in this version (see server step 3)
};

export type RevisionView = RevisionMeta & {
    project: Project;
    changes: {
        path: string;
        kind: "added" | "modified" | "deleted";
        sectionId?: string;
        documentId?: string;
        summary: string;
    }[];
};

// Applied snapshots are content-addressed (keyed by hash) and never change,
// so a fetched version can be cached for the life of the page.
const cache = new Map<string, RevisionView>();

export function useRevision(meta: RevisionMeta | undefined) {
    const [view, setView] = useState<RevisionView | null>(
        meta ? (cache.get(meta.hash) ?? null) : null,
    );
    const [error, setError] = useState("");

    useEffect(() => {
        setError("");
        if (!meta) {
            setView(null);
            return;
        }
        const hit = cache.get(meta.hash);
        if (hit) {
            setView(hit);
            return;
        }
        let live = true;
        setView(null);
        api<RevisionView>(`/revisions/${meta.n}`)
            .then((v) => {
                cache.set(meta.hash, v);
                if (live) setView(v);
            })
            .catch((e) => {
                if (live) setError((e as Error).message);
            });
        return () => {
            live = false;
        };
    }, [meta?.hash]);

    return { view, error };
}