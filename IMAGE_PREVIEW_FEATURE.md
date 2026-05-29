# Enhanced Image Preview System

## Overview

The Enhanced Image Preview System provides a comprehensive image viewing experience for issue attachments. Users can now preview images inline in the issue details panel with a full-featured image viewer modal.

## Features Implemented

### 1. Thumbnail Display in Issue List
- **Grid Layout**: Images are displayed in a responsive grid (100x100px thumbnails)
- **Image Count Badge**: Shows total number of images in the issue
- **Lazy Loading**: Thumbnails load on-demand for performance optimization
- **Hover Effects**: Filename tooltip appears on hover
- **Error Handling**: Displays error icon if thumbnail fails to load

### 2. Full-Screen Image Viewer Modal
- **High-Resolution Display**: Shows full-size images in a modal overlay
- **Navigation**: Arrow buttons and keyboard shortcuts (← →) to navigate between images
- **Image Counter**: Displays current image number and total count
- **Close Button**: X button in top-right corner
- **Keyboard Shortcuts**:
  - `ESC` - Close viewer
  - `←` / `→` - Navigate between images
  - `+` / `-` - Zoom in/out
  - Scroll wheel - Zoom in/out

### 3. Zoom Functionality
- **Zoom Controls**: +/- buttons for precise zoom control
- **Zoom Range**: 50% to 500% (0.5x to 5x)
- **Fit to Screen**: Button to reset zoom to 100%
- **Mouse Wheel**: Scroll to zoom in/out
- **Pinch-to-Zoom**: Mobile support for pinch gestures
- **Zoom Indicator**: Shows current zoom percentage in header

### 4. Pan/Drag Functionality
- **Drag to Pan**: Click and drag to pan when zoomed in
- **Cursor Feedback**: Cursor changes to grab/grabbing state
- **Boundary Constraints**: Pan is limited to image boundaries
- **Smooth Movement**: Smooth transitions when dragging

### 5. Image Rotation
- **90° Rotation**: Rotate button to rotate image in 90° increments
- **Persistent During Session**: Rotation state maintained while viewing
- **Reset on Navigation**: Rotation resets when switching images

### 6. Additional Features
- **Download Button**: Download full-resolution image
- **Loading Spinner**: Shows while fetching image
- **Error Handling**: Graceful error messages for broken/missing images
- **Responsive Design**: Works on desktop and mobile devices
- **Keyboard Hints**: Footer shows available keyboard shortcuts

## Component Architecture

### Frontend Components

#### `ImageViewer.tsx`
Main full-screen image viewer component with all viewing features.

**Props:**
```typescript
interface ImageViewerProps {
  images: Array<{ filename: string; url: string; index: number }>;
  initialIndex?: number;
  onClose: () => void;
}
```

**Features:**
- Zoom in/out with buttons and mouse wheel
- Pan/drag when zoomed
- Image rotation
- Navigation between images
- Download functionality
- Keyboard shortcuts
- Touch support (pinch-to-zoom)

#### `ImageThumbnailGrid.tsx`
Displays thumbnail grid of images in the issue details panel.

**Props:**
```typescript
interface ImageThumbnailGridProps {
  images: Array<{ filename: string; url: string; index: number }>;
  onSelectImage: (index: number) => void;
  imageCount?: number;
}
```

**Features:**
- Responsive grid layout
- Lazy loading of thumbnails
- Hover tooltips with filename
- Error state handling
- Image count display

### Hooks

#### `use-image-viewer.ts`
Custom hook for managing image viewer state.

**Returns:**
```typescript
{
  isOpen: boolean;
  selectedIndex: number;
  images: ImageData[];
  openViewer: (imageList: ImageData[], startIndex?: number) => void;
  closeViewer: () => void;
  selectImage: (index: number) => void;
}
```

### Utilities

#### `image-utils.ts`
Helper functions for image handling.

**Functions:**
- `isImageFile(filename: string)` - Check if file is an image
- `getImageMimeType(filename: string)` - Get MIME type
- `getThumbnailUrl(issueId: string, fileIndex: number)` - Generate thumbnail URL
- `getImageUrl(issueId: string, fileIndex: number)` - Generate full image URL
- `extractImageFiles(issueId: string, files: Array, fileStartIndex?: number)` - Filter and map image files

## Integration with Issues Page

The image preview system is integrated into the Issues page (`Issues.tsx`):

1. **Thumbnail Grid**: Displayed in the issue details panel above the files list
2. **Image Viewer**: Opens when clicking any thumbnail
3. **File List**: Maintains existing download functionality for all files

### Usage Example

```typescript
import { useImageViewer } from "@/hooks/use-image-viewer";
import ImageViewer from "@/components/ImageViewer";
import ImageThumbnailGrid from "@/components/ImageThumbnailGrid";
import { extractImageFiles } from "@/lib/image-utils";

// In component
const imageViewer = useImageViewer();

const handleOpenImageViewer = (issueId: string, startIndex = 0) => {
  const images = extractImageFiles(issueId, selected?.files || []);
  if (images.length > 0) {
    imageViewer.openViewer(images, startIndex);
  }
};

// In JSX
<ImageThumbnailGrid
  images={extractImageFiles(issueId, files)}
  onSelectImage={(index) => handleOpenImageViewer(issueId, index)}
/>

{imageViewer.isOpen && (
  <ImageViewer
    images={imageViewer.images}
    initialIndex={imageViewer.selectedIndex}
    onClose={imageViewer.closeViewer}
  />
)}
```

## Supported Image Formats

- PNG (.png)
- JPEG (.jpg, .jpeg)
- WebP (.webp)
- GIF (.gif)
- BMP (.bmp)

## Performance Optimizations

1. **Lazy Loading**: Thumbnails load on-demand
2. **Browser Caching**: Images are cached by the browser
3. **Efficient Re-renders**: React hooks prevent unnecessary re-renders
4. **Smooth Animations**: CSS transitions for smooth interactions
5. **Minimal Bundle Size**: Lightweight components with no external dependencies

## Accessibility Features

- **Keyboard Navigation**: Full keyboard support for all features
- **Semantic HTML**: Proper button and image elements
- **ARIA Labels**: Descriptive titles on interactive elements
- **Error Messages**: Clear error feedback
- **Loading States**: Visual feedback during loading

## Browser Compatibility

- Chrome/Edge 90+
- Firefox 88+
- Safari 14+
- Mobile browsers (iOS Safari, Chrome Mobile)

## Future Enhancements

Potential improvements for future versions:

1. **Image Filters**: Brightness, contrast, saturation adjustments
2. **Annotation Tools**: Draw or add text on images
3. **Comparison Mode**: Side-by-side image comparison
4. **Slideshow**: Auto-play slideshow of images
5. **Thumbnail Caching**: Server-side thumbnail generation
6. **Image Metadata**: Display EXIF data for photos
7. **Batch Download**: Download all images as ZIP
8. **Image Cropping**: Crop and save modified images

## Troubleshooting

### Images Not Loading
- Check that the backend is serving files correctly
- Verify file permissions on the server
- Check browser console for CORS errors

### Zoom Not Working
- Ensure JavaScript is enabled
- Try refreshing the page
- Check browser zoom level (Ctrl+0 to reset)

### Touch Gestures Not Working
- Verify device supports touch events
- Check browser touch event support
- Try using mouse wheel as alternative

## API Endpoints Used

The image preview system uses existing backend endpoints:

- `GET /api/v1/issues/{issue_id}/files/{file_index}` - Retrieve image file

No new backend endpoints are required. The system works with the existing file retrieval infrastructure.

## File Structure

```
curl2py_frontend/src/
├── components/
│   ├── ImageViewer.tsx           # Full-screen viewer modal
│   └── ImageThumbnailGrid.tsx    # Thumbnail grid display
├── hooks/
│   └── use-image-viewer.ts       # Image viewer state hook
├── lib/
│   └── image-utils.ts            # Image utility functions
└── pages/
    └── Issues.tsx                # Updated with image preview
```

## Testing

To test the image preview system:

1. Navigate to the Issues page
2. Select an issue with image attachments
3. Verify thumbnails appear in the details panel
4. Click a thumbnail to open the viewer
5. Test zoom, pan, rotation, and navigation
6. Test keyboard shortcuts
7. Test download functionality
8. Test on mobile devices for touch support

## Notes

- The system gracefully handles missing or broken images
- All image operations are client-side (no server processing)
- Images are displayed at full resolution from the backend
- The thumbnail grid is responsive and adapts to panel width
- The image viewer is full-screen and overlays the entire page
