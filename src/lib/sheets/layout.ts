// Axis geometry with sparse size overrides: offset(i) and indexAt(px) in O(log k).

export class Axis {
	private idx: number[] = [];
	private prefix: number[] = []; // cumulative delta (size - def) up to and including idx[j]
	readonly total: number;

	constructor(
		readonly count: number,
		readonly def: number,
		sizes: Map<number, number>,
		hidden?: Set<number>
	) {
		const overrides = new Map<number, number>();
		for (const [i, s] of sizes) if (i < count && s !== def) overrides.set(i, s);
		if (hidden) for (const i of hidden) if (i < count) overrides.set(i, 0);
		this.idx = [...overrides.keys()].sort((a, b) => a - b);
		let acc = 0;
		for (const i of this.idx) {
			acc += overrides.get(i)! - def;
			this.prefix.push(acc);
		}
		this.sizes = overrides;
		this.total = count * def + acc;
	}
	private sizes: Map<number, number>;

	size(i: number) {
		return this.sizes.get(i) ?? this.def;
	}

	/** Pixel offset where item i starts. */
	offset(i: number) {
		// number of overrides with index < i
		let lo = 0;
		let hi = this.idx.length;
		while (lo < hi) {
			const m = (lo + hi) >> 1;
			if (this.idx[m] < i) lo = m + 1;
			else hi = m;
		}
		return i * this.def + (lo ? this.prefix[lo - 1] : 0);
	}

	/** Item at pixel position px (clamped). */
	indexAt(px: number) {
		if (px <= 0) return 0;
		if (px >= this.total) return this.count - 1;
		let lo = 0;
		let hi = this.count - 1;
		while (lo < hi) {
			const m = (lo + hi + 1) >> 1;
			if (this.offset(m) <= px) lo = m;
			else hi = m - 1;
		}
		return lo;
	}

	isHidden(i: number) {
		return this.sizes.get(i) === 0;
	}
}
