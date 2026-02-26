import { WebContents } from 'electron'

export class SliderSolver {
  async solve(webContents: WebContents): Promise<string> {
    const script = `
      (function() {
        // Find slider elements
        const slider = document.querySelector(
          '[class*="slider" i] [class*="drag" i], ' +
          '[class*="slider" i] [class*="handle" i], ' +
          '[class*="slide" i][class*="btn" i], ' +
          '.slider-btn, .slide-btn, .drag-btn, ' +
          '[class*="captcha" i] [draggable], ' +
          'input[type="range"][class*="captcha" i]'
        );
        
        if (!slider) {
          return { error: 'Slider element not found' };
        }

        const track = slider.parentElement;
        const rect = slider.getBoundingClientRect();
        const trackRect = track ? track.getBoundingClientRect() : rect;
        const distance = trackRect.width - rect.width;
        
        if (distance <= 0) {
          return { error: 'Could not determine slide distance' };
        }

        // Simulate human-like drag
        const startX = rect.left + rect.width / 2;
        const startY = rect.top + rect.height / 2;
        
        // Mouse down
        slider.dispatchEvent(new MouseEvent('mousedown', {
          clientX: startX, clientY: startY, bubbles: true
        }));

        // Generate bezier curve path points for natural movement
        const steps = 20;
        const points = [];
        for (let i = 0; i <= steps; i++) {
          const t = i / steps;
          // Ease-out cubic for natural deceleration
          const eased = 1 - Math.pow(1 - t, 3);
          const x = startX + distance * eased;
          // Add slight vertical wobble for realism
          const y = startY + Math.sin(t * Math.PI) * (Math.random() * 3 - 1.5);
          points.push({ x, y });
        }

        // Dispatch mousemove events with delays
        let i = 0;
        function moveNext() {
          if (i >= points.length) {
            // Mouse up at end
            slider.dispatchEvent(new MouseEvent('mouseup', {
              clientX: points[points.length - 1].x,
              clientY: points[points.length - 1].y,
              bubbles: true
            }));
            return;
          }
          document.dispatchEvent(new MouseEvent('mousemove', {
            clientX: points[i].x,
            clientY: points[i].y,
            bubbles: true
          }));
          i++;
          setTimeout(moveNext, 15 + Math.random() * 20);
        }
        moveNext();

        return { ok: true, distance: distance };
      })()
    `

    try {
      const result = await webContents.executeJavaScript(script)
      if (result?.ok) {
        await new Promise(r => setTimeout(r, 1000))
        return `Slider CAPTCHA solved (dragged ${Math.round(result.distance)}px)`
      }
      return result?.error || 'Slider CAPTCHA could not be solved'
    } catch (err) {
      return `Slider solver error: ${(err as Error).message}`
    }
  }
}
