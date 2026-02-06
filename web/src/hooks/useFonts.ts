import { useEffect, useState } from "react";
import { loadEventFonts, fontsApi, type FontListItem } from "@/lib/fonts";

// Hook to load custom fonts for a specific event
export function useEventFontsLoader(eventId: string | undefined) {
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!eventId) return;

    const load = async () => {
      try {
        await loadEventFonts(eventId);
        setLoaded(true);
      } catch (err) {
        setError("Failed to load custom fonts");
        console.error(err);
      }
    };

    // Only load if user is authenticated
    const token = localStorage.getItem("token");
    if (token) {
      load();
    }
  }, [eventId]);

  return { loaded, error };
}

// Hook to manage fonts list for an event
export function useEventFonts(eventId: string | undefined) {
  const [fonts, setFonts] = useState<FontListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchFonts = async () => {
    if (!eventId) return;

    setLoading(true);
    setError(null);
    try {
      const data = await fontsApi.getFonts(eventId);
      setFonts(data);
    } catch (err) {
      setError("Failed to fetch fonts");
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchFonts();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load when eventId changes
  }, [eventId]);

  const uploadFont = async (data: {
    name: string;
    family: string;
    weight: string;
    style: string;
    file: File;
    licenseAccepted: boolean;
  }) => {
    if (!eventId) throw new Error("Event ID is required");

    const newFont = await fontsApi.uploadFont(eventId, data);
    setFonts([...fonts, newFont]);
    // Reload font into browser
    await loadEventFonts(eventId);
    return newFont;
  };

  const deleteFont = async (fontId: string) => {
    if (!eventId) throw new Error("Event ID is required");

    await fontsApi.deleteFont(eventId, fontId);
    setFonts(fonts.filter((f) => f.id !== fontId));
  };

  return {
    fonts,
    loading,
    error,
    fetchFonts,
    uploadFont,
    deleteFont,
  };
}
