// API contract captured from the installed Bazarr 1.6.2 Swagger schema.
export const bazarrCatalog = [
  {
    "name": "bazarr_get_badges",
    "path": "/api/badges",
    "method": "GET",
    "description": "Get badges count to update the UI",
    "parameters": []
  },
  {
    "name": "bazarr_get_episodes",
    "path": "/api/episodes",
    "method": "GET",
    "description": "List episodes metadata for specific series or episodes",
    "parameters": [
      {
        "name": "seriesid[]",
        "in": "query",
        "type": "array",
        "description": "Series IDs to list episodes for",
        "default": [],
        "items": {
          "type": "integer"
        }
      },
      {
        "name": "episodeid[]",
        "in": "query",
        "type": "array",
        "description": "Episodes ID to list",
        "default": [],
        "items": {
          "type": "integer"
        }
      }
    ]
  },
  {
    "name": "bazarr_get_episodes_blacklist",
    "path": "/api/episodes/blacklist",
    "method": "GET",
    "description": "List blacklisted episodes subtitles",
    "parameters": [
      {
        "name": "start",
        "in": "query",
        "type": "integer",
        "description": "Paging start integer",
        "default": 0
      },
      {
        "name": "length",
        "in": "query",
        "type": "integer",
        "description": "Paging length integer",
        "default": -1
      }
    ]
  },
  {
    "name": "bazarr_delete_episodes_blacklist",
    "path": "/api/episodes/blacklist",
    "method": "DELETE",
    "description": "Delete an episodes subtitles from blacklist",
    "parameters": [
      {
        "name": "all",
        "in": "query",
        "type": "string",
        "description": "Empty episodes subtitles blacklist"
      },
      {
        "name": "provider",
        "in": "query",
        "type": "string",
        "description": "Provider name"
      },
      {
        "name": "subs_id",
        "in": "query",
        "type": "string",
        "description": "Subtitles ID"
      }
    ]
  },
  {
    "name": "bazarr_post_episodes_blacklist",
    "path": "/api/episodes/blacklist",
    "method": "POST",
    "description": "Add an episodes subtitles to blacklist",
    "parameters": [
      {
        "name": "seriesid",
        "in": "query",
        "type": "integer",
        "required": true,
        "description": "Series ID"
      },
      {
        "name": "episodeid",
        "in": "query",
        "type": "integer",
        "required": true,
        "description": "Episode ID"
      },
      {
        "name": "provider",
        "in": "query",
        "type": "string",
        "required": true,
        "description": "Provider name"
      },
      {
        "name": "subs_id",
        "in": "query",
        "type": "string",
        "required": true,
        "description": "Subtitles ID"
      },
      {
        "name": "language",
        "in": "query",
        "type": "string",
        "required": true,
        "description": "Subtitles language"
      },
      {
        "name": "subtitles_path",
        "in": "query",
        "type": "string",
        "required": true,
        "description": "Subtitles file path"
      }
    ]
  },
  {
    "name": "bazarr_get_episodes_history",
    "path": "/api/episodes/history",
    "method": "GET",
    "description": "List episodes history events",
    "parameters": [
      {
        "name": "start",
        "in": "query",
        "type": "integer",
        "description": "Paging start integer",
        "default": 0
      },
      {
        "name": "length",
        "in": "query",
        "type": "integer",
        "description": "Paging length integer",
        "default": -1
      },
      {
        "name": "episodeid",
        "in": "query",
        "type": "integer",
        "description": "Episode ID"
      }
    ]
  },
  {
    "name": "bazarr_delete_episodes_subtitles",
    "path": "/api/episodes/subtitles",
    "method": "DELETE",
    "description": "Delete an episode subtitles",
    "parameters": [
      {
        "name": "seriesid",
        "in": "query",
        "type": "integer",
        "required": true,
        "description": "Series ID"
      },
      {
        "name": "episodeid",
        "in": "query",
        "type": "integer",
        "required": true,
        "description": "Episode ID"
      },
      {
        "name": "language",
        "in": "query",
        "type": "string",
        "required": true,
        "description": "Language code2"
      },
      {
        "name": "forced",
        "in": "query",
        "type": "string",
        "required": true,
        "description": "Forced true/false as string"
      },
      {
        "name": "hi",
        "in": "query",
        "type": "string",
        "required": true,
        "description": "HI true/false as string"
      },
      {
        "name": "path",
        "in": "query",
        "type": "string",
        "required": true,
        "description": "Path of the subtitles file"
      }
    ]
  },
  {
    "name": "bazarr_post_episodes_subtitles",
    "path": "/api/episodes/subtitles",
    "method": "POST",
    "description": "Upload an episode subtitles",
    "parameters": [
      {
        "name": "seriesid",
        "in": "query",
        "type": "integer",
        "required": true,
        "description": "Series ID"
      },
      {
        "name": "episodeid",
        "in": "query",
        "type": "integer",
        "required": true,
        "description": "Episode ID"
      },
      {
        "name": "language",
        "in": "query",
        "type": "string",
        "required": true,
        "description": "Language code2"
      },
      {
        "name": "forced",
        "in": "query",
        "type": "string",
        "required": true,
        "description": "Forced true/false as string"
      },
      {
        "name": "hi",
        "in": "query",
        "type": "string",
        "required": true,
        "description": "HI true/false as string"
      },
      {
        "name": "file",
        "in": "formData",
        "type": "file",
        "required": true,
        "description": "Subtitles file as file upload object"
      }
    ]
  },
  {
    "name": "bazarr_patch_episodes_subtitles",
    "path": "/api/episodes/subtitles",
    "method": "PATCH",
    "description": "Download an episode subtitles",
    "parameters": [
      {
        "name": "seriesid",
        "in": "query",
        "type": "integer",
        "required": true,
        "description": "Series ID"
      },
      {
        "name": "episodeid",
        "in": "query",
        "type": "integer",
        "required": true,
        "description": "Episode ID"
      },
      {
        "name": "language",
        "in": "query",
        "type": "string",
        "required": true,
        "description": "Language code2"
      },
      {
        "name": "forced",
        "in": "query",
        "type": "string",
        "required": true,
        "description": "Forced true/false as string"
      },
      {
        "name": "hi",
        "in": "query",
        "type": "string",
        "required": true,
        "description": "HI true/false as string"
      }
    ]
  },
  {
    "name": "bazarr_get_episodes_wanted",
    "path": "/api/episodes/wanted",
    "method": "GET",
    "description": "List episodes wanted subtitles",
    "parameters": [
      {
        "name": "start",
        "in": "query",
        "type": "integer",
        "description": "Paging start integer",
        "default": 0
      },
      {
        "name": "length",
        "in": "query",
        "type": "integer",
        "description": "Paging length integer",
        "default": -1
      },
      {
        "name": "episodeid[]",
        "in": "query",
        "type": "array",
        "description": "Episodes ID to list",
        "default": [],
        "items": {
          "type": "integer"
        }
      }
    ]
  },
  {
    "name": "bazarr_get_files",
    "path": "/api/files",
    "method": "GET",
    "description": "List Bazarr file system content",
    "parameters": [
      {
        "name": "path",
        "in": "query",
        "type": "string",
        "description": "Path to browse",
        "default": ""
      }
    ]
  },
  {
    "name": "bazarr_get_files_radarr",
    "path": "/api/files/radarr",
    "method": "GET",
    "description": "List Radarr file system content",
    "parameters": [
      {
        "name": "path",
        "in": "query",
        "type": "string",
        "description": "Path to browse",
        "default": ""
      }
    ]
  },
  {
    "name": "bazarr_get_files_sonarr",
    "path": "/api/files/sonarr",
    "method": "GET",
    "description": "List Sonarr file system content",
    "parameters": [
      {
        "name": "path",
        "in": "query",
        "type": "string",
        "description": "Path to browse",
        "default": ""
      }
    ]
  },
  {
    "name": "bazarr_get_history_stats",
    "path": "/api/history/stats",
    "method": "GET",
    "description": "Get history statistics",
    "parameters": [
      {
        "name": "timeFrame",
        "in": "query",
        "type": "string",
        "description": "Timeframe to get stats for. Must be in [\"week\", \"month\", \"trimester\", \"year\"]",
        "default": "month"
      },
      {
        "name": "action",
        "in": "query",
        "type": "string",
        "description": "Action type to filter for.",
        "default": "All"
      },
      {
        "name": "provider",
        "in": "query",
        "type": "string",
        "description": "Provider name to filter for.",
        "default": "All"
      },
      {
        "name": "language",
        "in": "query",
        "type": "string",
        "description": "Language name to filter for",
        "default": "All"
      }
    ]
  },
  {
    "name": "bazarr_get_movies",
    "path": "/api/movies",
    "method": "GET",
    "description": "List movies metadata for specific movies",
    "parameters": [
      {
        "name": "start",
        "in": "query",
        "type": "integer",
        "description": "Paging start integer",
        "default": 0
      },
      {
        "name": "length",
        "in": "query",
        "type": "integer",
        "description": "Paging length integer",
        "default": -1
      },
      {
        "name": "radarrid[]",
        "in": "query",
        "type": "array",
        "description": "Movies IDs to get metadata for",
        "default": [],
        "items": {
          "type": "integer"
        }
      },
      {
        "name": "sort_by",
        "in": "query",
        "type": "string",
        "description": "Column to sort by",
        "default": "title"
      },
      {
        "name": "sort_order",
        "in": "query",
        "type": "string",
        "description": "Sort direction",
        "default": "asc",
        "enum": [
          "asc",
          "desc"
        ]
      },
      {
        "name": "monitored",
        "in": "query",
        "type": "string",
        "description": "Filter by monitored status",
        "enum": [
          "true",
          "false"
        ]
      },
      {
        "name": "profileid",
        "in": "query",
        "type": "string",
        "description": "Filter by languages profile ID or \"none\""
      },
      {
        "name": "missing",
        "in": "query",
        "type": "string",
        "description": "Filter by missing subtitles",
        "enum": [
          "true",
          "false"
        ]
      },
      {
        "name": "audio_language",
        "in": "query",
        "type": "string",
        "description": "Filter by audio language name"
      },
      {
        "name": "tags[]",
        "in": "query",
        "type": "array",
        "description": "Tags to filter by",
        "default": [],
        "items": {
          "type": "string"
        }
      }
    ]
  },
  {
    "name": "bazarr_post_movies",
    "path": "/api/movies",
    "method": "POST",
    "description": "Update specific movies languages profile",
    "parameters": [
      {
        "name": "radarrid",
        "in": "query",
        "type": "array",
        "description": "Radarr movie(s) ID",
        "default": [],
        "items": {
          "type": "integer"
        }
      },
      {
        "name": "profileid",
        "in": "query",
        "type": "array",
        "description": "Languages profile(s) ID or \"none\"",
        "default": [],
        "items": {
          "type": "string"
        }
      }
    ]
  },
  {
    "name": "bazarr_patch_movies",
    "path": "/api/movies",
    "method": "PATCH",
    "description": "Run actions on specific movies",
    "parameters": [
      {
        "name": "radarrid",
        "in": "query",
        "type": "integer",
        "description": "Radarr movie ID"
      },
      {
        "name": "action",
        "in": "query",
        "type": "string",
        "description": "Action to perform from [\"scan-disk\", \"search-missing\", \"search-wanted\", \"sync\"]"
      }
    ]
  },
  {
    "name": "bazarr_get_movies_blacklist",
    "path": "/api/movies/blacklist",
    "method": "GET",
    "description": "List blacklisted movies subtitles",
    "parameters": [
      {
        "name": "start",
        "in": "query",
        "type": "integer",
        "description": "Paging start integer",
        "default": 0
      },
      {
        "name": "length",
        "in": "query",
        "type": "integer",
        "description": "Paging length integer",
        "default": -1
      }
    ]
  },
  {
    "name": "bazarr_delete_movies_blacklist",
    "path": "/api/movies/blacklist",
    "method": "DELETE",
    "description": "Delete a movies subtitles from blacklist",
    "parameters": [
      {
        "name": "all",
        "in": "query",
        "type": "string",
        "description": "Empty movies subtitles blacklist"
      },
      {
        "name": "provider",
        "in": "query",
        "type": "string",
        "description": "Provider name"
      },
      {
        "name": "subs_id",
        "in": "query",
        "type": "string",
        "description": "Subtitles ID"
      }
    ]
  },
  {
    "name": "bazarr_post_movies_blacklist",
    "path": "/api/movies/blacklist",
    "method": "POST",
    "description": "Add a movies subtitles to blacklist",
    "parameters": [
      {
        "name": "radarrid",
        "in": "query",
        "type": "integer",
        "required": true,
        "description": "Radarr ID"
      },
      {
        "name": "provider",
        "in": "query",
        "type": "string",
        "required": true,
        "description": "Provider name"
      },
      {
        "name": "subs_id",
        "in": "query",
        "type": "string",
        "required": true,
        "description": "Subtitles ID"
      },
      {
        "name": "language",
        "in": "query",
        "type": "string",
        "required": true,
        "description": "Subtitles language"
      },
      {
        "name": "subtitles_path",
        "in": "query",
        "type": "string",
        "required": true,
        "description": "Subtitles file path"
      }
    ]
  },
  {
    "name": "bazarr_get_movies_history",
    "path": "/api/movies/history",
    "method": "GET",
    "description": "List movies history events",
    "parameters": [
      {
        "name": "start",
        "in": "query",
        "type": "integer",
        "description": "Paging start integer",
        "default": 0
      },
      {
        "name": "length",
        "in": "query",
        "type": "integer",
        "description": "Paging length integer",
        "default": -1
      },
      {
        "name": "radarrid",
        "in": "query",
        "type": "integer",
        "description": "Movie ID"
      }
    ]
  },
  {
    "name": "bazarr_delete_movies_subtitles",
    "path": "/api/movies/subtitles",
    "method": "DELETE",
    "description": "Delete a movie subtitles",
    "parameters": [
      {
        "name": "radarrid",
        "in": "query",
        "type": "integer",
        "required": true,
        "description": "Movie ID"
      },
      {
        "name": "language",
        "in": "query",
        "type": "string",
        "required": true,
        "description": "Language code2"
      },
      {
        "name": "forced",
        "in": "query",
        "type": "string",
        "required": true,
        "description": "Forced true/false as string"
      },
      {
        "name": "hi",
        "in": "query",
        "type": "string",
        "required": true,
        "description": "HI true/false as string"
      },
      {
        "name": "path",
        "in": "query",
        "type": "string",
        "required": true,
        "description": "Path of the subtitles file"
      }
    ]
  },
  {
    "name": "bazarr_post_movies_subtitles",
    "path": "/api/movies/subtitles",
    "method": "POST",
    "description": "Upload a movie subtitles",
    "parameters": [
      {
        "name": "radarrid",
        "in": "query",
        "type": "integer",
        "required": true,
        "description": "Movie ID"
      },
      {
        "name": "language",
        "in": "query",
        "type": "string",
        "required": true,
        "description": "Language code2"
      },
      {
        "name": "forced",
        "in": "query",
        "type": "string",
        "required": true,
        "description": "Forced true/false as string"
      },
      {
        "name": "hi",
        "in": "query",
        "type": "string",
        "required": true,
        "description": "HI true/false as string"
      },
      {
        "name": "file",
        "in": "formData",
        "type": "file",
        "required": true,
        "description": "Subtitles file as file upload object"
      }
    ]
  },
  {
    "name": "bazarr_patch_movies_subtitles",
    "path": "/api/movies/subtitles",
    "method": "PATCH",
    "description": "Download a movie subtitles",
    "parameters": [
      {
        "name": "radarrid",
        "in": "query",
        "type": "integer",
        "required": true,
        "description": "Movie ID"
      },
      {
        "name": "language",
        "in": "query",
        "type": "string",
        "required": true,
        "description": "Language code2"
      },
      {
        "name": "forced",
        "in": "query",
        "type": "string",
        "required": true,
        "description": "Forced true/false as string"
      },
      {
        "name": "hi",
        "in": "query",
        "type": "string",
        "required": true,
        "description": "HI true/false as string"
      }
    ]
  },
  {
    "name": "bazarr_get_movies_tags",
    "path": "/api/movies/tags",
    "method": "GET",
    "description": "List all distinct tags assigned to any movie",
    "parameters": []
  },
  {
    "name": "bazarr_get_movies_wanted",
    "path": "/api/movies/wanted",
    "method": "GET",
    "description": "List movies wanted subtitles",
    "parameters": [
      {
        "name": "start",
        "in": "query",
        "type": "integer",
        "description": "Paging start integer",
        "default": 0
      },
      {
        "name": "length",
        "in": "query",
        "type": "integer",
        "description": "Paging length integer",
        "default": -1
      },
      {
        "name": "radarrid[]",
        "in": "query",
        "type": "array",
        "description": "Movies ID to list",
        "default": [],
        "items": {
          "type": "integer"
        }
      }
    ]
  },
  {
    "name": "bazarr_get_providers",
    "path": "/api/providers",
    "method": "GET",
    "description": "Get providers status",
    "parameters": [
      {
        "name": "history",
        "in": "query",
        "type": "string",
        "description": "Provider name for history stats"
      }
    ]
  },
  {
    "name": "bazarr_post_providers",
    "path": "/api/providers",
    "method": "POST",
    "description": "Reset providers status",
    "parameters": [
      {
        "name": "action",
        "in": "query",
        "type": "string",
        "required": true,
        "description": "Action to perform from [\"reset\"]"
      }
    ]
  },
  {
    "name": "bazarr_get_providers_episodes",
    "path": "/api/providers/episodes",
    "method": "GET",
    "description": "Search manually for an episode subtitles",
    "parameters": [
      {
        "name": "episodeid",
        "in": "query",
        "type": "integer",
        "required": true,
        "description": "Episode ID"
      }
    ]
  },
  {
    "name": "bazarr_post_providers_episodes",
    "path": "/api/providers/episodes",
    "method": "POST",
    "description": "Manually download an episode subtitles",
    "parameters": [
      {
        "name": "seriesid",
        "in": "query",
        "type": "integer",
        "required": true,
        "description": "Series ID"
      },
      {
        "name": "episodeid",
        "in": "query",
        "type": "integer",
        "required": true,
        "description": "Episode ID"
      },
      {
        "name": "hi",
        "in": "query",
        "type": "string",
        "required": true,
        "description": "HI subtitles from [\"True\", \"False\"]"
      },
      {
        "name": "forced",
        "in": "query",
        "type": "string",
        "required": true,
        "description": "Forced subtitles from [\"True\", \"False\"]"
      },
      {
        "name": "original_format",
        "in": "query",
        "type": "string",
        "required": true,
        "description": "Use original subtitles format from [\"True\", \"False\"]"
      },
      {
        "name": "provider",
        "in": "query",
        "type": "string",
        "required": true,
        "description": "Provider name"
      },
      {
        "name": "subtitle",
        "in": "query",
        "type": "string",
        "required": true,
        "description": "Subtitle ID as returned by GET"
      }
    ]
  },
  {
    "name": "bazarr_get_providers_movies",
    "path": "/api/providers/movies",
    "method": "GET",
    "description": "Search manually for a movie subtitles",
    "parameters": [
      {
        "name": "radarrid",
        "in": "query",
        "type": "integer",
        "required": true,
        "description": "Movie ID"
      }
    ]
  },
  {
    "name": "bazarr_post_providers_movies",
    "path": "/api/providers/movies",
    "method": "POST",
    "description": "Manually download a movie subtitles",
    "parameters": [
      {
        "name": "radarrid",
        "in": "query",
        "type": "integer",
        "required": true,
        "description": "Movie ID"
      },
      {
        "name": "hi",
        "in": "query",
        "type": "string",
        "required": true,
        "description": "HI subtitles from [\"True\", \"False\"]"
      },
      {
        "name": "forced",
        "in": "query",
        "type": "string",
        "required": true,
        "description": "Forced subtitles from [\"True\", \"False\"]"
      },
      {
        "name": "original_format",
        "in": "query",
        "type": "string",
        "required": true,
        "description": "Use original subtitles format from [\"True\", \"False\"]"
      },
      {
        "name": "provider",
        "in": "query",
        "type": "string",
        "required": true,
        "description": "Provider name"
      },
      {
        "name": "subtitle",
        "in": "query",
        "type": "string",
        "required": true,
        "description": "Subtitle ID as returned by GET"
      }
    ]
  },
  {
    "name": "bazarr_get_series",
    "path": "/api/series",
    "method": "GET",
    "description": "List series metadata for specific series",
    "parameters": [
      {
        "name": "start",
        "in": "query",
        "type": "integer",
        "description": "Paging start integer",
        "default": 0
      },
      {
        "name": "length",
        "in": "query",
        "type": "integer",
        "description": "Paging length integer",
        "default": -1
      },
      {
        "name": "seriesid[]",
        "in": "query",
        "type": "array",
        "description": "Series IDs to get metadata for",
        "default": [],
        "items": {
          "type": "integer"
        }
      },
      {
        "name": "sort_by",
        "in": "query",
        "type": "string",
        "description": "Column to sort by",
        "default": "title"
      },
      {
        "name": "sort_order",
        "in": "query",
        "type": "string",
        "description": "Sort direction",
        "default": "asc",
        "enum": [
          "asc",
          "desc"
        ]
      },
      {
        "name": "monitored",
        "in": "query",
        "type": "string",
        "description": "Filter by monitored status",
        "enum": [
          "true",
          "false"
        ]
      },
      {
        "name": "profileid",
        "in": "query",
        "type": "string",
        "description": "Filter by languages profile ID or \"none\""
      },
      {
        "name": "missing",
        "in": "query",
        "type": "string",
        "description": "Filter by missing subtitles",
        "enum": [
          "true",
          "false"
        ]
      },
      {
        "name": "audio_language",
        "in": "query",
        "type": "string",
        "description": "Filter by audio language name"
      },
      {
        "name": "tags[]",
        "in": "query",
        "type": "array",
        "description": "Tags to filter by",
        "default": [],
        "items": {
          "type": "string"
        }
      }
    ]
  },
  {
    "name": "bazarr_post_series",
    "path": "/api/series",
    "method": "POST",
    "description": "Update specific series languages profile",
    "parameters": [
      {
        "name": "seriesid",
        "in": "query",
        "type": "array",
        "description": "Sonarr series ID",
        "default": [],
        "items": {
          "type": "integer"
        }
      },
      {
        "name": "profileid",
        "in": "query",
        "type": "array",
        "description": "Languages profile(s) ID or \"none\"",
        "default": [],
        "items": {
          "type": "string"
        }
      }
    ]
  },
  {
    "name": "bazarr_patch_series",
    "path": "/api/series",
    "method": "PATCH",
    "description": "Run actions on specific series",
    "parameters": [
      {
        "name": "seriesid",
        "in": "query",
        "type": "integer",
        "description": "Sonarr series ID"
      },
      {
        "name": "action",
        "in": "query",
        "type": "string",
        "description": "Action to perform from [\"scan-disk\", \"search-missing\", \"search-wanted\", \"sync\"]"
      }
    ]
  },
  {
    "name": "bazarr_get_series_tags",
    "path": "/api/series/tags",
    "method": "GET",
    "description": "List all distinct tags assigned to any series",
    "parameters": []
  },
  {
    "name": "bazarr_get_subtitles",
    "path": "/api/subtitles",
    "method": "GET",
    "description": "Return available audio and embedded subtitles tracks with external subtitles",
    "parameters": [
      {
        "name": "subtitlesPath",
        "in": "query",
        "type": "string",
        "required": true,
        "description": "External subtitles file path"
      },
      {
        "name": "sonarrEpisodeId",
        "in": "query",
        "type": "integer",
        "description": "Sonarr Episode ID"
      },
      {
        "name": "radarrMovieId",
        "in": "query",
        "type": "integer",
        "description": "Radarr Movie ID"
      }
    ]
  },
  {
    "name": "bazarr_patch_subtitles",
    "path": "/api/subtitles",
    "method": "PATCH",
    "description": "Apply mods/tools on external subtitles",
    "parameters": [
      {
        "name": "action",
        "in": "query",
        "type": "string",
        "required": true,
        "description": "Action from [\"sync\", \"translate\", \"extract\" or mods name]"
      },
      {
        "name": "language",
        "in": "query",
        "type": "string",
        "required": true,
        "description": "Language code2"
      },
      {
        "name": "path",
        "in": "query",
        "type": "string",
        "description": "Subtitles file path"
      },
      {
        "name": "type",
        "in": "query",
        "type": "string",
        "required": true,
        "description": "Media type from [\"episode\", \"movie\"]"
      },
      {
        "name": "id",
        "in": "query",
        "type": "integer",
        "required": true,
        "description": "Media ID (episodeId, radarrId)"
      },
      {
        "name": "forced",
        "in": "query",
        "type": "string",
        "description": "Forced subtitles from [\"True\", \"False\"]"
      },
      {
        "name": "hi",
        "in": "query",
        "type": "string",
        "description": "HI subtitles from [\"True\", \"False\"]"
      },
      {
        "name": "original_format",
        "in": "query",
        "type": "string",
        "description": "Use original subtitles format from [\"True\", \"False\"]"
      },
      {
        "name": "reference",
        "in": "query",
        "type": "string",
        "description": "Reference to use for sync from video file track number (a:0) or some subtitles file path"
      },
      {
        "name": "max_offset_seconds",
        "in": "query",
        "type": "string",
        "description": "Maximum offset seconds to allow"
      },
      {
        "name": "no_fix_framerate",
        "in": "query",
        "type": "string",
        "description": "Don't try to fix framerate from [\"True\", \"False\"]"
      },
      {
        "name": "gss",
        "in": "query",
        "type": "string",
        "description": "Use Golden-Section Search from [\"True\", \"False\"]"
      },
      {
        "name": "quality_min_score",
        "in": "query",
        "type": "string",
        "description": "Minimum quality score for sync (0.0-1.0)"
      },
      {
        "name": "quality_max_offset_seconds",
        "in": "query",
        "type": "string",
        "description": "Maximum offset in seconds for quality checks"
      },
      {
        "name": "quality_max_framerate_deviation",
        "in": "query",
        "type": "string",
        "description": "Maximum framerate deviation (0.0-1.0)"
      },
      {
        "name": "subtitles_id",
        "in": "query",
        "type": "integer",
        "description": "Subtitles database ID (required for the \"extract\" action)"
      }
    ]
  },
  {
    "name": "bazarr_get_subtitles_contents",
    "path": "/api/subtitles/contents",
    "method": "GET",
    "description": "Retrieve subtitle file contents",
    "parameters": [
      {
        "name": "subtitlePath",
        "in": "query",
        "type": "string",
        "required": true,
        "description": "Subtitle filepath"
      }
    ]
  },
  {
    "name": "bazarr_get_subtitles_info",
    "path": "/api/subtitles/info",
    "method": "GET",
    "description": "Guessit over subtitles filename",
    "parameters": [
      {
        "name": "filenames[]",
        "in": "query",
        "type": "array",
        "required": true,
        "description": "Subtitles filenames",
        "items": {
          "type": "string"
        }
      }
    ]
  },
  {
    "name": "bazarr_get_system_health",
    "path": "/api/system/health",
    "method": "GET",
    "description": "List health issues",
    "parameters": []
  },
  {
    "name": "bazarr_get_system_jobs",
    "path": "/api/system/jobs",
    "method": "GET",
    "description": "List jobs from the queue",
    "parameters": [
      {
        "name": "id",
        "in": "query",
        "type": "integer",
        "description": "Job ID to return"
      },
      {
        "name": "status",
        "in": "query",
        "type": "string",
        "description": "Job status to return",
        "enum": [
          "pending",
          "running",
          "failed",
          "completed"
        ]
      }
    ]
  },
  {
    "name": "bazarr_delete_system_jobs",
    "path": "/api/system/jobs",
    "method": "DELETE",
    "description": "Delete a job from the queue",
    "parameters": [
      {
        "name": "id",
        "in": "query",
        "type": "integer",
        "required": true,
        "description": "Job ID to delete from queue"
      }
    ]
  },
  {
    "name": "bazarr_post_system_jobs",
    "path": "/api/system/jobs",
    "method": "POST",
    "description": "Force start, move to top or move to bottom of the queue a specific job",
    "parameters": [
      {
        "name": "id",
        "in": "query",
        "type": "integer",
        "required": true,
        "description": "Job ID act onto"
      },
      {
        "name": "action",
        "in": "query",
        "type": "string",
        "required": true,
        "description": "Action to perform from [\"force_start\", \"move_top\", \"move_bottom\"]"
      }
    ]
  },
  {
    "name": "bazarr_patch_system_jobs",
    "path": "/api/system/jobs",
    "method": "PATCH",
    "description": "Empty a specific jobs queue",
    "parameters": [
      {
        "name": "queueName",
        "in": "query",
        "type": "string",
        "required": true,
        "description": "Jobs queue name to empty",
        "enum": [
          "pending",
          "failed",
          "completed"
        ]
      }
    ]
  },
  {
    "name": "bazarr_get_system_languages",
    "path": "/api/system/languages",
    "method": "GET",
    "description": "List languages for history filter or for language filter menu",
    "parameters": [
      {
        "name": "history",
        "in": "query",
        "type": "string",
        "description": "Language name for history stats"
      }
    ]
  },
  {
    "name": "bazarr_get_language_profiles",
    "path": "/api/system/languages/profiles",
    "method": "GET",
    "description": "List languages profiles",
    "parameters": []
  },
  {
    "name": "bazarr_get_system_logs",
    "path": "/api/system/logs",
    "method": "GET",
    "description": "List log entries",
    "parameters": []
  },
  {
    "name": "bazarr_delete_system_logs",
    "path": "/api/system/logs",
    "method": "DELETE",
    "description": "Force log rotation and create a new log file",
    "parameters": []
  },
  {
    "name": "bazarr_get_system_searches",
    "path": "/api/system/searches",
    "method": "GET",
    "description": "List results from query",
    "parameters": [
      {
        "name": "query",
        "in": "query",
        "type": "string",
        "required": true,
        "description": "Series or movie name to search for"
      }
    ]
  },
  {
    "name": "bazarr_get_system_status",
    "path": "/api/system/status",
    "method": "GET",
    "description": "Return environment information and versions",
    "parameters": []
  },
  {
    "name": "bazarr_get_system_tasks",
    "path": "/api/system/tasks",
    "method": "GET",
    "description": "List scheduled tasks and their job_id, running state and next run. Includes mass wanted movie and episode subtitle searches",
    "parameters": [
      {
        "name": "taskid",
        "in": "query",
        "type": "string",
        "description": "Optional task ID"
      }
    ]
  },
  {
    "name": "bazarr_post_system_tasks",
    "path": "/api/system/tasks",
    "method": "POST",
    "description": "Trigger a scheduled task immediately using its job_id from bazarr_get_system_tasks. Supports mass wanted subtitle searches; prefer bazarr_search_wanted_movies or bazarr_search_wanted_episodes for those",
    "parameters": [
      {
        "name": "taskid",
        "in": "query",
        "type": "string",
        "required": true,
        "description": "Task id of the task to run"
      }
    ]
  },
  {
    "name": "bazarr_get_system_backups",
    "path": "/api/system/backups",
    "method": "GET",
    "description": "List backup files",
    "parameters": []
  },
  {
    "name": "bazarr_post_system_backups",
    "path": "/api/system/backups",
    "method": "POST",
    "description": "Create a new backup",
    "parameters": []
  },
  {
    "name": "bazarr_get_system_releases",
    "path": "/api/system/releases",
    "method": "GET",
    "description": "Get Bazarr releases",
    "parameters": []
  }
] as const;
