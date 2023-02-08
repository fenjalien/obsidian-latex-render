import { App, FileSystemAdapter, MarkdownPostProcessorContext, Plugin, PluginSettingTab, SectionCache, Setting, TFile, TFolder } from 'obsidian';
import { Md5 } from 'ts-md5';
import * as fs from 'fs';
import * as temp from 'temp';
import * as path from 'path';
import { exec } from 'child_process';

interface MyPluginSettings {
	command: string,
	timeout: number,
	enableCache: boolean,
	cache: Map<string, Set<string>>; // Key: md5 hash of latex source. Value: Set of file path names.
}

const DEFAULT_SETTINGS: MyPluginSettings = {
	// `"${this.settings.pdflatexCommand}" -interaction=nonstopmode -halt-on-error -shell-escape "${texFile}" && "${this.settings.pdf2svgCommand}" "${path.join(cwd, pdfFile)}" "${cwd}"`
	// 
	command: `pdflatex -interaction=nonstopmode -halt-on-error -shell-escape "{tex-file}" && pdf2svg "{pdf-file}" "{output-dir}"`,
	timeout: 10000,
	enableCache: true,
	cache: new Map(),
}

export default class MyPlugin extends Plugin {
	settings: MyPluginSettings;
	cacheFolderPath: string;

	cache: Map<string, Set<string>>; // Key: md5 hash of latex source. Value: Set of file path names.

	async onload() {
		await this.loadSettings();
		if (this.settings.enableCache) await this.loadCache();

		this.addSettingTab(new SampleSettingTab(this.app, this));
		this.registerMarkdownCodeBlockProcessor("latex", (source, el, ctx) => this.renderLatexToElement(source, el, ctx));
	}

	onunload() {
		if (this.settings.enableCache) this.unloadCache();
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}


	async saveSettings() {
		await this.saveData(this.settings);
	}

	async loadCache() {
		this.cacheFolderPath = path.join((this.app.vault.adapter as FileSystemAdapter).getBasePath(), this.app.vault.configDir, "obsidian-latex-render-svg-cache\\");
		if (!fs.existsSync(this.cacheFolderPath)) {
			fs.mkdirSync(this.cacheFolderPath);
			this.cache = new Map();
		} else {
			this.cache = this.settings.cache;
		}
	}

	unloadCache() {
		fs.rmdirSync(this.cacheFolderPath, { recursive: true });
	}

	formatLatexSource(source: string) {
		return "\\documentclass{standalone}\n" + source;
	}

	hashLatexSource(source: string) {
		return Md5.hashStr(source);
	}


	async renderLatexToElement(source: string, el: HTMLElement, ctx: MarkdownPostProcessorContext) {
		return new Promise<void>((resolve, reject) => {
			source = this.formatLatexSource(source);
			let md5Hash = this.hashLatexSource(source);
			let svgPath = path.join(this.cacheFolderPath, `${md5Hash}.svg`);

			// SVG file has already been cached
			// Could have a case where svgCache has the key but the cached file has been deleted
			if (this.settings.enableCache && this.cache.has(md5Hash) && fs.existsSync(svgPath)) {
				el.innerHTML = fs.readFileSync(svgPath).toString();
				this.addFileToCache(md5Hash, ctx.sourcePath);
				resolve();
			}
			else {
				this.renderLatexToSVG(source, md5Hash, svgPath).then((v: string) => {
					if (this.settings.enableCache) this.addFileToCache(md5Hash, ctx.sourcePath);
					el.innerHTML = v;
					resolve();
				}
				).catch(err => { el.innerHTML = err; reject(err); });
			}
		}).then(() => { if (this.settings.enableCache) setTimeout(() => this.cleanUpCache(), 1000); });
	}

	renderLatexToSVG(source: string, md5Hash: string, svgPath: string) {
		return new Promise(async (resolve, reject) => {
			let texFile = md5Hash + ".tex";
			let pdfFile = md5Hash + ".pdf";

			temp.mkdir("obsidian-latex-renderer", (err, dirPath) => {
				if (err) reject(err);
				fs.writeFileSync(path.join(dirPath, texFile), source);
				exec(
					this.settings.command.replace("{tex-file}", texFile).replace("{pdf-file}", path.join(dirPath, pdfFile)).replace("{output-dir}", dirPath)
					,
					{ timeout: this.settings.timeout, cwd: dirPath },
					async (err, stdout, stderr) => {
						if (err) reject([err, stdout, stderr]);
						else {
							if (this.settings.enableCache) fs.copyFileSync(path.join(dirPath, "content1.svg"), svgPath);
							let svgData = fs.readFileSync(path.join(dirPath, "content1.svg"));
							resolve(svgData);
						};
					},
				);
			})
		});
	}

	async saveCache() {
		this.settings.cache = this.cache;
		await this.saveSettings();
	}

	addFileToCache(hash: string, file_path: string) {
		if (!this.cache.has(hash)) {
			this.cache.set(hash, new Set());
		}
		this.cache.get(hash)?.add(file_path);
	}

	async cleanUpCache() {
		let file_paths = new Set<string>();
		for (const fps of this.cache.values()) {
			for (const fp of fps) {
				file_paths.add(fp);
			}
		}

		for (const file_path of file_paths) {
			let file = this.app.vault.getAbstractFileByPath(file_path);
			if (file == null) {
				this.removeFileFromCache(file_path);
			} else {
				await this.removeUnusedCachesForFile(file as TFile);
			}
		}
		await this.saveCache();
	}

	async removeUnusedCachesForFile(file: TFile) {
		let hashes_in_file = await this.getLatexHashesFromFile(file);
		let hashes_in_cache = this.getLatexHashesFromCacheForFile(file);
		for (const hash of hashes_in_cache) {
			if (!hashes_in_file.contains(hash)) {
				this.cache.get(hash)?.delete(file.path);
				if (this.cache.get(hash)?.size == 0) {
					this.removeSVGFromCache(hash);
				}
			}
		}
	}

	removeSVGFromCache(key: string) {
		this.cache.delete(key);
		fs.rmSync(path.join(this.cacheFolderPath, `${key}.svg`));
	}

	removeFileFromCache(file_path: string) {
		for (const hash of this.cache.keys()) {
			this.cache.get(hash)?.delete(file_path);
			if (this.cache.get(hash)?.size == 0) {
				this.removeSVGFromCache(hash);
			}
		}
	}

	getLatexHashesFromCacheForFile(file: TFile) {
		let hashes: string[] = [];
		let path = file.path;
		for (const [k, v] of this.cache.entries()) {
			if (v.has(path)) {
				hashes.push(k);
			}
		}
		return hashes;
	}

	async getLatexHashesFromFile(file: TFile) {
		let hashes: string[] = [];
		let sections = this.app.metadataCache.getFileCache(file)?.sections
		if (sections != undefined) {
			let lines = (await this.app.vault.read(file)).split('\n');
			for (const section of sections) {
				if (section.type != "code" && lines[section.position.start.line].match("``` *latex") == null) continue;
				let file_source = lines.slice(section.position.start.line + 1, section.position.end.line).join("\n");
				let source = this.formatLatexSource(file_source);
				let hash = this.hashLatexSource(source);
				hashes.push(hash);
			}
		}
		return hashes;
	}
}

class SampleSettingTab extends PluginSettingTab {
	plugin: MyPlugin;

	constructor(app: App, plugin: MyPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();

		containerEl.createEl('h2', { text: 'Settings for my awesome plugin.' });

		new Setting(containerEl)
			.setName('Command to generate SVG')
			.addText(text => text
				.setValue(this.plugin.settings.command.toString())
				.onChange(async (value) => {
					this.plugin.settings.command = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Enable caching of SVGs')
			.setDesc("SVGs rendered by this pluing will be kept in `.obsidian/obsidian-latex-render-svg-cache`. The plugin will automatically keep track of used svgs and remove any that aren't being used")
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.enableCache)
				.onChange(async (value) => {
					this.plugin.settings.enableCache = value;
					await this.plugin.saveSettings();
				}));
	}
}

