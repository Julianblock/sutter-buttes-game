const BIRD_SVG = `<svg class="silhouette" viewBox="0 0 120 40" fill="none" xmlns="http://www.w3.org/2000/svg">
<path d="M60 22c-3-1-5-3-6-6-6-1-14-2-22-6-6-3-12-5-20-6 4 3 7 4 9 6-3 0-6 1-9 1 5 2 10 3 14 4 6 2 13 5 20 7l2 6 4-3 2 3 3-5c7-2 14-5 20-7 4-1 9-2 14-4-3 0-6-1-9-1 2-2 5-3 9-6-8 1-14 3-20 6-8 4-16 5-22 6-1 3-3 5-6 6z" fill="#e8c890" opacity=".9"/>
</svg>`;

/** Title card shown while terrain, imagery and land cover stream in. */
export class LoadingScreen {
  readonly root = document.createElement('div');
  private bar: HTMLElement;
  private status: HTMLElement;

  constructor() {
    this.root.className = 'loading';
    this.root.innerHTML = `<div class="inner">${BIRD_SVG}
      <div class="eyebrow">Sutter Buttes · California</div>
      <div class="title">Flight of the <em>Middle Mountain</em></div>
      <p class="lede">A ring of volcanic peaks 1.6 million years old, standing alone above the rice fields and marshes of the Sacramento Valley — the smallest mountain range in the world.</p>
      <div class="bar"><i></i></div><div class="status">Preparing</div></div>`;
    this.bar = this.root.querySelector('.bar i')!;
    this.status = this.root.querySelector('.status')!;
  }

  progress(label: string, f: number) {
    this.bar.style.width = `${Math.round(f * 100)}%`;
    this.status.textContent = label;
  }

  done() {
    this.progress('Ready', 1);
    this.root.classList.add('done');
    setTimeout(() => this.root.remove(), 1600);
  }
}
