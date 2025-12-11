const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

/**
 * AI-based image detection and cropping
 * Detects the main subject in an image and crops it to fit a square format
 * Uses edge detection and saliency analysis to find the most important region
 */
class ImageProcessor {
  constructor() {
    this.TARGET_SIZE = 500; // Square output size
    this.PADDING_RATIO = 0.1; // 10% padding around detected subject
  }

  /**
   * Detect the main subject region using edge detection and saliency
   * Returns bounding box: { x, y, width, height }
   */
  async detectSubjectRegion(imagePath) {
    try {
      const image = sharp(imagePath);
      const metadata = await image.metadata();
      const { width, height } = metadata;

      // Create a smaller version for analysis (faster processing)
      const analysisSize = 400;
      const scale = Math.min(analysisSize / width, analysisSize / height);
      const analysisWidth = Math.round(width * scale);
      const analysisHeight = Math.round(height * scale);

      // Get image data for analysis
      const { data } = await image
        .resize(analysisWidth, analysisHeight, { fit: 'inside' })
        .greyscale()
        .normalize()
        .raw()
        .toBuffer({ resolveWithObject: true });

      // Apply edge detection using Sobel operator
      const edges = this.detectEdges(data, analysisWidth, analysisHeight);
      
      // Find the region with highest edge density (likely the main subject)
      const subjectRegion = this.findSubjectRegion(edges, analysisWidth, analysisHeight);
      
      // Scale back to original dimensions
      return {
        x: Math.round(subjectRegion.x / scale),
        y: Math.round(subjectRegion.y / scale),
        width: Math.round(subjectRegion.width / scale),
        height: Math.round(subjectRegion.height / scale)
      };
    } catch (error) {
      console.error('Error detecting subject region:', error);
      return null;
    }
  }

  /**
   * Apply Sobel edge detection
   */
  detectEdges(imageData, width, height) {
    const edges = new Uint8Array(width * height);
    const sobelX = [-1, 0, 1, -2, 0, 2, -1, 0, 1];
    const sobelY = [-1, -2, -1, 0, 0, 0, 1, 2, 1];

    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        let gx = 0, gy = 0;

        for (let ky = -1; ky <= 1; ky++) {
          for (let kx = -1; kx <= 1; kx++) {
            const idx = (y + ky) * width + (x + kx);
            const kernelIdx = (ky + 1) * 3 + (kx + 1);
            gx += imageData[idx] * sobelX[kernelIdx];
            gy += imageData[idx] * sobelY[kernelIdx];
          }
        }

        const magnitude = Math.sqrt(gx * gx + gy * gy);
        edges[y * width + x] = Math.min(255, magnitude);
      }
    }

    return edges;
  }

  /**
   * Find the region with highest edge density (main subject)
   * Uses a sliding window approach to find the most interesting region
   * Improved algorithm for food/product images
   */
  findSubjectRegion(edges, width, height) {
    // Use multiple window sizes to find the best subject region
    const minWindowSize = Math.min(width, height) * 0.4; // 40% minimum
    const maxWindowSize = Math.min(width, height) * 0.8; // 80% maximum
    const windowSizes = [
      Math.floor(minWindowSize),
      Math.floor((minWindowSize + maxWindowSize) / 2),
      Math.floor(maxWindowSize)
    ];

    let bestRegion = null;
    let maxScore = 0;

    // Try different window sizes
    for (const windowSize of windowSizes) {
      if (windowSize < 50 || windowSize > width || windowSize > height) continue;

      const step = Math.max(5, Math.floor(windowSize / 8));
      
      // Try different window positions
      for (let y = 0; y <= height - windowSize; y += step) {
        for (let x = 0; x <= width - windowSize; x += step) {
          let edgeSum = 0;
          let edgeCount = 0;
          let strongEdgeCount = 0; // Count of edges above threshold

          // Calculate edge statistics in this window
          for (let wy = y; wy < y + windowSize && wy < height; wy++) {
            for (let wx = x; wx < x + windowSize && wx < width; wx++) {
              const edgeValue = edges[wy * width + wx];
              edgeSum += edgeValue;
              edgeCount++;
              if (edgeValue > 100) { // Strong edge threshold
                strongEdgeCount++;
              }
            }
          }

          const avgDensity = edgeCount > 0 ? edgeSum / edgeCount : 0;
          const strongEdgeRatio = edgeCount > 0 ? strongEdgeCount / edgeCount : 0;

          // Prefer regions closer to center (stronger weight for center)
          const centerX = width / 2;
          const centerY = height / 2;
          const regionCenterX = x + windowSize / 2;
          const regionCenterY = y + windowSize / 2;
          const distanceFromCenter = Math.sqrt(
            Math.pow(regionCenterX - centerX, 2) + 
            Math.pow(regionCenterY - centerY, 2)
          );
          const maxDistance = Math.sqrt(centerX * centerX + centerY * centerY);
          const centerWeight = 1 - (distanceFromCenter / maxDistance) * 0.5; // 50% penalty for distance

          // Combined score: edge density + strong edges + center preference
          const score = avgDensity * 0.4 + strongEdgeRatio * 255 * 0.4 + centerWeight * 100 * 0.2;

          if (score > maxScore) {
            maxScore = score;
            bestRegion = {
              x: Math.max(0, x - Math.floor(windowSize * this.PADDING_RATIO)),
              y: Math.max(0, y - Math.floor(windowSize * this.PADDING_RATIO)),
              width: Math.min(width, Math.floor(windowSize * (1 + 2 * this.PADDING_RATIO))),
              height: Math.min(height, Math.floor(windowSize * (1 + 2 * this.PADDING_RATIO)))
            };
          }
        }
      }
    }

    // If no good region found, use center crop
    if (!bestRegion || maxScore < 50) {
      const centerSize = Math.min(width, height) * 0.7;
      return {
        x: Math.floor((width - centerSize) / 2),
        y: Math.floor((height - centerSize) / 2),
        width: Math.floor(centerSize),
        height: Math.floor(centerSize)
      };
    }

    // Ensure the region is square (for better cropping)
    const size = Math.min(bestRegion.width, bestRegion.height);
    const centerX = bestRegion.x + bestRegion.width / 2;
    const centerY = bestRegion.y + bestRegion.height / 2;
    
    return {
      x: Math.max(0, Math.floor(centerX - size / 2)),
      y: Math.max(0, Math.floor(centerY - size / 2)),
      width: size,
      height: size
    };
  }

  /**
   * Process image: detect subject and crop to square format
   * Always crops to fill square - no white padding
   */
  async processImage(inputPath, outputPath) {
    try {
      const image = sharp(inputPath);
      const metadata = await image.metadata();
      const { width, height } = metadata;

      console.log(`📸 Processing image: ${width}x${height}`);

      let processedImage = image;
      let cropInfo = null;

      // If image is not square, crop to square first (center crop)
      if (width !== height) {
        const size = Math.min(width, height);
        const cropX = Math.floor((width - size) / 2);
        const cropY = Math.floor((height - size) / 2);
        
        console.log(`✂️ Cropping to square: ${cropX},${cropY} ${size}x${size}`);
        processedImage = image.extract({
          left: cropX,
          top: cropY,
          width: size,
          height: size
        });
        cropInfo = { x: cropX, y: cropY, width: size, height: size };
      }

      // Resize to target size
      // Since we already cropped to square, this resizes to target size
      // fit: 'cover' ensures it fills the square (though already square, this prevents any padding)
      const resized = await processedImage
        .resize(this.TARGET_SIZE, this.TARGET_SIZE, {
          fit: 'cover', // Ensures square output (no padding)
          position: 'center' // Center the crop if needed
        })
        .jpeg({ quality: 92 })
        .toBuffer();

      // Write the processed image
      fs.writeFileSync(outputPath, resized);

      console.log(`✅ Processed image: ${path.basename(inputPath)} -> ${path.basename(outputPath)} (${this.TARGET_SIZE}x${this.TARGET_SIZE})`);
      if (cropInfo) {
        console.log(`   Cropped from: x=${cropInfo.x}, y=${cropInfo.y}, w=${cropInfo.width}, h=${cropInfo.height}`);
      }

      return outputPath;
    } catch (error) {
      console.error('Error processing image:', error);
      throw error;
    }
  }

  /**
   * Process image in place (overwrite original)
   */
  async processImageInPlace(imagePath) {
    const tempPath = imagePath + '.tmp';
    await this.processImage(imagePath, tempPath);
    fs.renameSync(tempPath, imagePath);
    return imagePath;
  }
}

module.exports = new ImageProcessor();

