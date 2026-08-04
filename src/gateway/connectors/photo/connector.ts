import type { SourceConnector, DataRow, SourceBoundary, ActionResult } from '../types.js';
import { stripExifMetadata } from '../../filters.js';

export interface PhotoConnectorConfig {
  mobileBridge?: boolean;
}

/**
 * Device Photos / Media connector.
 * Provides zero-access photo query and EXIF GPS / identifiable metadata stripping by default.
 */
export class PhotoConnector implements SourceConnector {
  name = 'photo';
  private mobileBridge: boolean;
  private memoryPhotos: DataRow[] = [
    {
      source: 'photo',
      source_item_id: 'img-1',
      type: 'image',
      timestamp: '2026-07-28T12:00:00Z',
      data: {
        title: 'Receipt_Lunch.jpg',
        album: 'Receipts',
        width: 4032,
        height: 3024,
        dataUrl: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI0MDAiIGhlaWdodD0iNTAwIiB2aWV3Qm94PSIwIDAgNDAwIDUwMCI+CiAgPHJlY3Qgd2lkdGg9IjEwMCUiIGhlaWdodD0iMTAwJSIgZmlsbD0iI2Y4ZmFmYyIvPgogIDxyZWN0IHg9IjMwIiB5PSIzMCIgd2lkdGg9IjM0MCIgaGVpZ2h0PSI0NDAiIHJ4PSI4IiBmaWxsPSIjZmZmZmZmIiBzdHJva2U9IiNlMmU4ZjAiIHN0cm9rZS13aWR0aD0iMiIvPgogIDx0ZXh0IHg9IjIwMCIgeT0iODAiIHRleHQtYW5jaG9yPSJtaWRkbGUiIGZvbnQtZmFtaWx5PSJtb25vc3BhY2UiIGZvbnQtc2l6ZT0iMjIiIGZvbnQtd2VpZ2h0PSJib2xkIiBmaWxsPSIjMGYxNzJhIj5CSVNUUk8gVkVSREU8L3RleHQ+CiAgPHRleHQgeD0iMjAwIiB5PSIxMDUiIHRleHQtYW5jaG9yPSJtaWRkbGUiIGZvbnQtZmFtaWx5PSJtb25vc3BhY2UiIGZvbnQtc2l6ZT0iMTIiIGZpbGw9IiM2NDc0OGIiPjE0MiBLaW5nIFN0LCBTZWF0dGxlIFdBPC90ZXh0PgogIDxsaW5lIHgxPSI1MCIgeTE9IjEzMCIgeDI9IjM1MCIgeTI9IjEzMCIgc3Ryb2tlPSIjY2JkNWUxIiBzdHJva2UtZGFzaGFycmF5PSI0Ii8+CiAgPHRleHQgeD0iNTAiIHk9IjE3MCIgZm9udC1mYW1pbHk9Im1vbm9zcGFjZSIgZm9udC1zaXplPSIxNCIgZmlsbD0iIzFlMjkzYiI+MXggUm9hc3RlZCBTYWxtb248L3RleHQ+CiAgPHRleHQgeD0iMzUwIiB5PSIxN0AiIHRleHQtYW5jaG9yPSJlbmQiIGZvbnQtZmFtaWx5PSJtb25vc3BhY2UiIGZvbnQtc2l6ZT0iMTQiIGZpbGw9IiMxZTI5M2IiPiQyOC4wMDwvdGV4dD4KICA8dGV4dCB4PSI1MCIgeT0iMjAwIiBmb250LWZhbWlseT0ibW9ub3NwYWNlIiBmb250LXNpemU9IjE0IiBmaWxsPSIjMWUyOTNiIj4xeCBBdm9jYWRvIFNhbGFkPC90ZXh0PgogIDx0ZXh0IHg9IjM1MCIgeT0iMjAwIiB0ZXh0LWFuY2hvcj0iZW5kIiBmb250LWZhbWlseT0ibW9ub3NwYWNlIiBmb250LXNpemU9IjE0IiBmaWxsPSIjMWUyOTNiIj4kMTQuMDA8L3RleHQ+CiAgPHRleHQgeD0iNTAiIHk9IjIzMCIgZm9udC1mYW1pbHk9Im1vbm9zcGFjZSIgZm9udC1zaXplPSIxNCIgZmlsbD0iIzFlMjkzYiI+MXggSWNlZCBHcmVlbiBUZWE8L3RleHQ+CiAgPHRleHQgeD0iMzUwIiB5PSIyMzAiIHRleHQtYW5jaG9yPSJlbmQiIGZvbnQtZmFtaWx5PSJzYW5zLXNlcmlmIiBmb250LXNpemU9IjE0IiBmaWxsPSIjMWUyOTNiIj4kNC41MDwvdGV4dD4KICA8bGluZSB4MT0iNTAiIHkxPSIyNjAiIHgyPSIzNTAiIHkyPSIyNjAiIHN0cm9rZT0iI2NiZDVlMSIgc3Ryb2tlLWRhc2hhcnJheT0iNCIvPgogIDx0ZXh0IHg9IjUwIiB5PSIzMDAiIGZvbnQtZmFtaWx5PSJtb25vc3BhY2UiIGZvbnQtc2l6ZT0iMTYiIGZvbnQtd2VpZ2h0PSJib2xkIiBmaWxsPSIjMGYxNzJhIj5UT1RBTDwvdGV4dD4KICA8dGV4dCB4PSIzNTAiIHk9IjMwMCIgdGV4dC1hbmNob3I9ImVuZCIgZm9udC1mYW1pbHk9Im1vbm9zcGFjZSIgZm9udC1zaXplPSIxNiIgZm9udC13ZWlnaHQ9ImJvbGQiIGZpbGw9IiMwZmEwODEiPiQ1MS4xNTwvdGV4dD4KICA8cmVjdCB4PSI4MCIgeT0iMzYwIiB3aWR0aD0iMjQwIiBoZWlnaHQ9IjQwIiBmaWxsPSIjZjFmNWY5Ii8+CiAgPHRleHQgeD0iMjAwIiB5PSIzODUiIHRleHQtYW5jaG9yPSJtaWRkbGUiIGZvbnQtZmFtaWx5PSJtb25vc3BhY2UiIGZvbnQtc2l6ZT0iMTAiIGZpbGw9IiM2NDc0OGIiPnx8fCB8IHx8fHwgfHwgfCB8fCB8fHwgfCB8fCB8fDwvdGV4dD4KPC9zdmc+',
        latitude: 37.7749,
        longitude: -122.4194,
        cameraModel: 'iPhone 16 Pro',
        serialNumber: 'SN-F829K91J',
      },
    },
    {
      source: 'photo',
      source_item_id: 'img-2',
      type: 'image',
      timestamp: '2026-07-27T15:30:00Z',
      data: {
        title: 'Screenshot_Flight.png',
        album: 'Screenshots',
        width: 1080,
        height: 2400,
        dataUrl: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI0MDAiIGhlaWdodD0iMjUwIiB2aWV3Qm94PSIwIDAgNDAwIDI1MCI+CiAgPHJlY3Qgd2lkdGg9IjEwMCUiIGhlaWdodD0iMTAwJSIgcng9IjE2IiBmaWxsPSIjMWUxYjRiIi8+CiAgPHRleHQgeD0iMzAiIHk9IjQ1IiBmb250LWZhbWlseT0ic2Fucy1zZXJpZiIgZm9udC1zaXplPSIxNiIgZm9udC13ZWlnaHQ9ImJvbGQiIGZpbGw9IiNmZmZmZmYiPkFFUk8gQUlSTElORVM8L3RleHQ+CiAgPHRleHQgeD0iMzcwIiB5PSI0NSIgdGV4dC1hbmNob3I9ImVuZCIgZm9udC1mYW1pbHk9Im1vbm9zcGFjZSIgZm9udC1zaXplPSIxMiIgZmlsbD0iIzYwYTVmYSI+RklSU1QgQ0xBU1M8L3RleHQ+CiAgPHRleHQgeD0iNDAiIHk9IjExMCIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iMzYiIGZvbnQtd2VpZ2h0PSJib2xkIiBmaWxsPSIjZmZmZmZmIj5TRk88L3RleHQ+CiAgPHRleHQgeD0iNDAiIHk9IjEzMCIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iMTIiIGZpbGw9IiM5M2M1ZmQiPlNhbiBGcmFuY2lzY288L3RleHQ+CiAgPGxpbmUgeDE9IjE0MCIgeTE9IjEwMCIgeDI9IjI2MCIgeTI9IjEwMCIgc3Ryb2tlPSIjNjBhNWZhIiBzdHJva2UtZGFzaGFycmF5PSI2Ii8+CiAgPHRleHQgeD0iMzYwIiB5PSIxMTAiIHRleHQtYW5jaG9yPSJlbmQiIGZvbnQtZmFtaWx5PSJzYW5zLXNlcmlmIiBmb250LXNpemU9IjM2IiBmb250LXdlaWdodD0iYm9sZCIgZmlsbD0iI2ZmZmZmZiI+SkZLPC90ZXh0PgogIDx0ZXh0IHg9IjM2MCIgeT0iMTMwIiB0ZXh0LWFuY2hvcj0iZW5kIiBmb250LWZhbWlseT0ic2Fucy1zZXJpZiIgZm9udC1zaXplPSIxMiIgZmlsbD0iIzkzYzVmZCI+TmV3IFlvcms8L3RleHQ+CiAgPHJlY3QgeD0iMzAiIHk9IjE2NSIgd2lkdGg9IjM0MCIgaGVpZ2h0PSI1NSIgcng9IjgiIGZpbGw9IiMzMTJlODEiLz4KICA8dGV4dCB4PSI1MCIgeT0iMTg4IiBmb250LWZhbWlseT0ibW9ub3NwYWNlIiBmb250LXNpemU9IjEwIiBmaWxsPSIjOTNjNWZkIj5GTElHSFQ8L3RleHQ+CiAgPHRleHQgeD0iNTAiIHk9IjIwNiIgZm9udC1mYW1pbHk9Im1vbm9zcGFjZSIgZm9udC1zaXplPSIxNCIgZm9udC13ZWlnaHQ9ImJvbGQiIGZpbGw9IiNmZmZmZmYiPkFSIDQwOTI8L3RleHQ+CiAgPHRleHQgeD0iMTgwIiB5PSIxODgiIGZvbnQtZmFtaWx5PSJtb25vc3BhY2UiIGZvbnQtc2l6ZT0iMTAiIGZpbGw9IiM5M2M1ZmQiPkdBVEU8L3RleHQ+CiAgPHRleHQgeD0iMTgwIiB5PSIyMDYiIGZvbnQtZmFtaWx5PSJtb25vc3BhY2UiIGZvbnQtc2l6ZT0iMTQiIGZvbnQtd2VpZ2h0PSJib2xkIiBmaWxsPSIjZmZmZmZmIj5HMTI8L3RleHQ+CiAgPHRleHQgeD0iMzAwIiB5PSIxODgiIGZvbnQtZmFtaWx5PSJtb25vc3BhY2UiIGZvbnQtc2l6ZT0iMTAiIGZpbGw9IiM5M2M1ZmQiPlNFQVQ8L3RleHQ+CiAgPHRleHQgeD0iMzAwIiB5PSIyMDYiIGZvbnQtZmFtaWx5PSJtb25vc3BhY2UiIGZvbnQtc2l6ZT0iMTQiIGZvbnQtd2VpZ2h0PSJib2xkIiBmaWxsPSIjMzRkMzk5Ij40QTwvdGV4dD4KPC9zdmc+',
        latitude: 37.6213,
        longitude: -122.3790,
      },
    },
    {
      source: 'photo',
      source_item_id: 'img-3',
      type: 'image',
      timestamp: '2026-07-25T09:15:00Z',
      data: {
        title: 'Whiteboard_Notes.jpg',
        album: 'Work',
        width: 3024,
        height: 4032,
        dataUrl: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI0MDAiIGhlaWdodD0iMzAwIiB2aWV3Qm94PSIwIDAgNDAwIDMwMCI+CiAgPHJlY3Qgd2lkdGg9IjEwMCUiIGhlaWdodD0iMTAwJSIgcng9IjEyIiBmaWxsPSIjZmZmYmViIiBzdHJva2U9IiNmZGU2OGEiIHN0cm9rZS13aWR0aD0iNCIvPgogIDx0ZXh0IHg9IjIwMCIgeT0iNDAiIHRleHQtYW5jaG9yPSJtaWRkbGUiIGZvbnQtZmFtaWx5PSJzYW5zLXNlcmlmIiBmb250LXNpemU9IjE2IiBmb250LXdlaWdodD0iYm9sZCIgZmlsbD0iIzc4MzUwZiI+QVJDSElURUNUVVJFIFdISVRFQk9BUkQ8L3RleHQ+CiAgPHJlY3QgeD0iNTAiIHk9IjcwIiB3aWR0aD0iMzAwIiBoZWlnaHQ9IjQwIiByeD0iNiIgZmlsbD0iI2ZmZmZmZiIgc3Ryb2tlPSIjZDk3NzA2IiBzdHJva2Utd2lkdGg9IjIiLz4KICA8dGV4dCB4PSIyMDAiIHk9Ijk1IiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBmb250LWZhbWlseT0ibW9ub3NwYWNlIiBmb250LXNpemU9IjEzIiBmb250LXdlaWdodD0iYm9sZCIgZmlsbD0iIzQzMzhjYSI+WyBBbmRyb2lkIC8gaU9TIERldmljZSBdPC90ZXh0PgogIDx0ZXh0IHg9IjIwMCIgeT0iMTM1IiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBmb250LWZhbWlseT0ic2Fucy1zZXJpZiIgZm9udC1zaXplPSIxNiIgZmlsbD0iI2Q5NzcwNiI+4o2DPC90ZXh0PgogIDxyZWN0IHg9IjUwIiB5PSIxNTAiIHdpZHRoPSIzMDAiIGhlaWdodD0iNDAiIHJ4PSI2IiBmaWxsPSIjZmZmZmZmIiBzdHJva2U9IiNkOTc3MDYiIHN0cm9rZS13aWR0aD0iMiIvPgogIDx0ZXh0IHg9IjIwMCIgeT0iMTc1IiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBmb250LWZhbWlseT0ibW9ub3NwYWNlIiBmb250LXNpemU9IjEzIiBmb250LXdlaWdodD0iYm9sZCIgZmlsbD0iIzA1OTY2OSI+KCBIb25vIEdhdGV3YXkgOjMwMDAgKTwvdGV4dD4KICA8dGV4dCB4PSIyMDAiIHk9IjIxNSIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iMTYiIGZpbGw9IiNkOTc3MDYiPuKNgzwvdGV4dD4KICA8cmVjdCB4PSI1MCIgeT0iMjMwIiB3aWR0aD0iMzAwIiBoZWlnaHQ9IjQwIiByeD0iNiIgZmlsbD0iI2ZmZmZmZiIgc3Ryb2tlPSIjZDk3NzA2IiBzdHJva2Utd2lkdGg9IjIiLz4KICA8dGV4dCB4PSIyMDAiIHk9IjI1NSIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZm9udC1mYW1pbHk9Im1vbm9zcGFjZSIgZm9udC1zaXplPSIxMyIgZm9udC13ZWlnaHQ9ImJvbGQiIGZpbGw9IiM3YzNhZWQiPlsgWmVyby1BY2Nlc3MgQUkgU2FuZGJveCBdPC90ZXh0Pgo8L3N2Zz4=',
        latitude: 37.7833,
        longitude: -122.4167,
        cameraModel: 'iPhone 16 Pro',
        serialNumber: 'SN-F829K91J',
      },
    },
    {
      source: 'photo',
      source_item_id: 'img-4',
      type: 'image',
      timestamp: '2026-07-24T18:45:00Z',
      data: {
        title: 'Expense_Report.jpg',
        album: 'Receipts',
        width: 4032,
        height: 3024,
        dataUrl: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI0MDAiIGhlaWdodD0iMjgwIiB2aWV3Qm94PSIwIDAgNDAwIDI4MCI+CiAgPHJlY3Qgd2lkdGg9IjEwMCUiIGhlaWdodD0iMTAwJSIgcng9IjEyIiBmaWxsPSIjZmZmZmZmIiBzdHJva2U9IiNjYmQ1ZTEiIHN0cm9rZS13aWR0aD0iMiIvPgogIDx0ZXh0IHg9IjMwIiB5PSI0MCIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iMTYiIGZvbnQtd2VpZ2h0PSJib2xkIiBmaWxsPSIjMGYxNzJhIj5RMyBFWFBFTlNFIFJFUE9SVDwvdGV4dD4KICA8cmVjdCB4PSIyOTAiIHk9IjIyIiB3aWR0aD0iODAiIGhlaWdodD0iMjQiIHJ4PSI0IiBmaWxsPSIjZGNmY2U3Ii8+CiAgPHRleHQgeD0iMzMwIiB5PSIzOCIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iMTEiIGZvbnQtd2VpZ2h0PSJib2xkIiBmaWxsPSIjMTY2NTM0Ij5BUFBST1ZFRDwvdGV4dD4KICA8bGluZSB4MT0iMzAiIHkxPSI2MCIgeDI9IjM3MCIgeTI9IjYwIiBzdHJva2U9IiNlMmU4ZjAiIHN0cm9rZS13aWR0aD0iMiIvPgogIDx0ZXh0IHg9IjMwIiB5PSI5NSIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iMTQiIGZvbnQtd2VpZ2h0PSJib2xkIiBmaWxsPSIjMzM0MTU1Ij5BZXJvIEFpcmxpbmVzIEZsaWdodDwvdGV4dD4KICA8dGV4dCB4PSIzNzAiIHk9Ijk1IiB0ZXh0LWFuY2hvcj0iZW5kIiBmb250LWZhbWlseT0ibW9ub3NwYWNlIiBmb250LXNpemU9IjE0IiBmb250LXdlaWdodD0iYm9sZCIgZmlsbD0iIzBmMTcyYSI+JDQ4MC4wMDwvdGV4dD4KICA8dGV4dCB4PSIzMCIgeT0iMTQwIiBmb250LWZhbWlseT0ic2Fucy1zZXJpZiIgZm9udC1zaXplPSIxNCIgZm9udC13ZWlnaHQ9ImJvbGQiIGZpbGw9IiMzMzQxNTUiPkdyYW5kIFBsYXphIEhvdGVsPC90ZXh0PgogIDx0ZXh0IHg9IjM3MCIgeT0iMTQwIiB0ZXh0LWFuY2hvcj0iZW5kIiBmb250LWZhbWlseT0ibW9ub3NwYWNlIiBmb250LXNpemU9IjE0IiBmb250LXdlaWdodD0iYm9sZCIgZmlsbD0iIzBmMTcyYSI+JDUyMC4wMDwvdGV4dD4KICA8dGV4dCB4PSIzMCIgeT0iMTg1IiBmb250LWZhbWlseT0ic2Fucy1zZXJpZiIgZm9udC1zaXplPSIxNCIgZm9udC13ZWlnaHQ9ImJvbGQiIGZpbGw9IiMzMzQxNTUiPkJpc3RybyBWZXJkZSBMdW5jaDwvdGV4dD4KICA8dGV4dCB4PSIzNzAiIHk9IjE4NSIgdGV4dC1hbmNob3I9ImVuZCIgZm9udC1mYW1pbHk9Im1vbm9zcGFjZSIgZm9udC1zaXplPSIxNCIgZm9udC13ZWlnaHQ9ImJvbGQiIGZpbGw9IiMwZjE3MmEiPiQ1MS4xNTwvdGV4dD4KICA8cmVjdCB4PSIzMCIgeT0iMjEwIiB3aWR0aD0iMzQwIiBoZWlnaHQ9IjQ1IiByeD0iOCIgZmlsbD0iI2Y4ZmFmYyIvPgogIDx0ZXh0IHg9IjUwIiB5PSIyMzgiIGZvbnQtZmFtaWx5PSJzYW5zLXNlcmlmIiBmb250LXNpemU9IjE0IiBmb250LXdlaWdodD0iYm9sZCIgZmlsbD0iIzBmMTcyYSI+VE9UQUwgUkVJTUJVUlNFTUVOVDwvdGV4dD4KICA8dGV4dCB4PSIzNTAiIHk9IjIzOCIgdGV4dC1hbmNob3I9ImVuZCIgZm9udC1mYW1pbHk9Im1vbm9zcGFjZSIgZm9udC1zaXplPSIxNiIgZm9udC13ZWlnaHQ9ImJvbGQiIGZpbGw9IiMwZmEwODEiPiQxLDA1MS4xNTwvdGV4dD4KPC9zdmc+',
        latitude: 37.7749,
        longitude: -122.4194,
        cameraModel: 'iPhone 16 Pro',
        serialNumber: 'SN-F829K91J',
      },
    },
  ];

  constructor(config: PhotoConnectorConfig = {}) {
    this.mobileBridge = config.mobileBridge ?? false;
    // On the real mobile app, wait for an actual device sync instead of showing
    // hardcoded demo photos indistinguishably from real gallery contents.
    if (this.mobileBridge) {
      this.memoryPhotos = [];
    }
  }

  /**
   * For testing or local fallback: register photos in memory.
   */
  setMemoryPhotos(photos: DataRow[]): void {
    this.memoryPhotos = photos;
  }

  async fetch(boundary: SourceBoundary, params?: Record<string, unknown>): Promise<DataRow[]> {
    let rows: DataRow[] = [...this.memoryPhotos];

    // Filter by timestamp (boundary.after)
    if (boundary.after) {
      const afterTime = new Date(boundary.after).getTime();
      rows = rows.filter((r) => new Date(r.timestamp).getTime() >= afterTime);
    }

    // Filter by album if requested
    if (params?.album) {
      const targetAlbum = String(params.album).toLowerCase();
      rows = rows.filter((r) => {
        const rowAlbum = String(r.data.album || r.data.folder || '').toLowerCase();
        return rowAlbum.includes(targetAlbum);
      });
    }

    // Enforce automatic EXIF GPS / identifiable metadata stripping by default
    const keepExif = Boolean(params?.keepExif);
    if (!keepExif) {
      rows = rows.map((row) => ({
        ...row,
        data: stripExifMetadata(row.data),
      }));
    }

    return rows;
  }

  async executeAction(actionType: string, actionData: Record<string, unknown>): Promise<ActionResult> {
    switch (actionType) {
      case 'share_photo':
        return {
          success: true,
          message: `Staged photo share for photo ID ${String(actionData.photoId || actionData.id)}`,
          resultData: { action: 'share_photo', ...actionData },
        };
      case 'create_album':
        return {
          success: true,
          message: `Staged create album "${String(actionData.albumName)}"`,
          resultData: { action: 'create_album', ...actionData },
        };
      case 'attach_photo':
        return {
          success: true,
          message: `Staged attach photo to draft ${String(actionData.draftId)}`,
          resultData: { action: 'attach_photo', ...actionData },
        };
      case 'delete_photo': {
        const photoId = String(actionData.photoId);
        this.memoryPhotos = this.memoryPhotos.filter((p) => p.source_item_id !== photoId);
        return {
          success: true,
          message: `Deleted photo ${photoId}`,
          resultData: { action: 'delete_photo', ...actionData },
        };
      }
      default:
        return {
          success: false,
          message: `Unsupported action type: ${actionType}`,
        };
    }
  }
}
