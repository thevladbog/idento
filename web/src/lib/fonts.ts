import api from "./api";

export interface FontListItem {
  id: string;
  name: string;
  family: string;
  weight: string;
  style: string;
  format: string;
  size: number;
  created_at: string;
}

export interface FontUploadData {
  name: string;
  family: string;
  weight: string;
  style: string;
  file: File;
  licenseAccepted: boolean;
}

export const fontsApi = {
  // Get list of all fonts for an event
  getFonts: async (eventId: string): Promise<FontListItem[]> => {
    try {
      const response = await api.get<FontListItem[]>(
        `/api/events/${eventId}/fonts`
      );
      return response.data || [];
    } catch (error) {
      console.error("Failed to fetch fonts", error);
      return [];
    }
  },

  // Upload a new font to an event
  uploadFont: async (
    eventId: string,
    data: FontUploadData
  ): Promise<FontListItem> => {
    const formData = new FormData();
    formData.append("name", data.name);
    formData.append("family", data.family);
    formData.append("weight", data.weight);
    formData.append("style", data.style);
    formData.append("file", data.file);
    formData.append(
      "license_accepted",
      data.licenseAccepted ? "true" : "false"
    );

    const response = await api.post<FontListItem>(
      `/api/events/${eventId}/fonts`,
      formData,
      {
        headers: {
          "Content-Type": "multipart/form-data",
        },
      }
    );
    return response.data;
  },

  // Delete a font from an event
  deleteFont: async (eventId: string, fontId: string): Promise<void> => {
    await api.delete(`/api/events/${eventId}/fonts/${fontId}`);
  },

  // Get font file URL
  getFontFileUrl: (fontId: string): string => {
    const baseUrl = import.meta.env.VITE_API_URL || "http://localhost:8080";
    return `${baseUrl}/api/fonts/${fontId}/file`;
  },

  // Get CSS URL for all event fonts
  getFontsCSSUrl: (eventId: string): string => {
    const baseUrl = import.meta.env.VITE_API_URL || "http://localhost:8080";
    return `${baseUrl}/api/events/${eventId}/fonts/css`;
  },
};

// Load fonts for a specific event dynamically into the browser
export async function loadEventFonts(eventId: string): Promise<void> {
  try {
    const fonts = await fontsApi.getFonts(eventId);

    for (const font of fonts) {
      const fontUrl = fontsApi.getFontFileUrl(font.id);

      // Create @font-face via FontFace API
      const fontFace = new FontFace(font.family, `url(${fontUrl})`, {
        weight: font.weight,
        style: font.style,
      });

      try {
        await fontFace.load();
        document.fonts.add(fontFace);
        console.log(
          `✅ Font loaded: ${font.family} ${font.weight} ${font.style}`
        );
      } catch (error) {
        console.error(`❌ Failed to load font: ${font.family}`, error);
      }
    }
  } catch (error) {
    console.error("Failed to load event fonts", error);
  }
}

// Get list of available fonts for an event (system + custom)
export async function getAvailableFonts(eventId?: string): Promise<string[]> {
  const systemFonts = [
    "Arial",
    "Times New Roman",
    "Courier New",
    "Georgia",
    "Verdana",
    "Tahoma",
    "Trebuchet MS",
    "Helvetica",
    "Impact",
    "Comic Sans MS",
  ];

  if (!eventId) {
    return systemFonts;
  }

  try {
    const customFonts = await fontsApi.getFonts(eventId);
    const customFamilies = [...new Set(customFonts.map((f) => f.family))];
    return [...customFamilies, ...systemFonts];
  } catch {
    return systemFonts;
  }
}
