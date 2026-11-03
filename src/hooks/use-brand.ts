"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

export interface Brand {
  name: string | null;
  logoUrl: string | null;
}

/**
 * The global white-label brand (name + logo) the agency sets in
 * /agencia/marca.
 *
 * Shared by the rail and the top bar — before the redesign the
 * sidebar owned this fetch, and splitting navigation across two
 * surfaces would otherwise have meant two components racing the same
 * query. Resolves to `{ null, null }` when no brand is set or the
 * table predates the branding migration; callers fall back to the
 * translated product name.
 */
export function useBrand(): Brand {
  const [brand, setBrand] = useState<Brand>({ name: null, logoUrl: null });

  useEffect(() => {
    let active = true;
    createClient()
      .from("app_branding")
      .select("name, logo_url")
      .maybeSingle()
      .then(({ data }) => {
        if (active && data) {
          setBrand({ name: data.name ?? null, logoUrl: data.logo_url ?? null });
        }
      });
    return () => {
      active = false;
    };
  }, []);

  return brand;
}
