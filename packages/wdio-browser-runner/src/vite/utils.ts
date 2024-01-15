/* eslint-disable quotes */
import fs from 'node:fs/promises'
import url from 'node:url'
import path from 'node:path'
import logger from '@wdio/logger'
import { expect } from 'expect'
import { resolve } from 'import-meta-resolve'
import type { InlineConfig } from 'vite'
import type { AsymmetricMatchers } from 'expect-webdriverio'

import { MOCHA_VARIABELS } from '../constants.js'
import type { Environment, FrameworkPreset } from '../types.js'

const log = logger('@wdio/browser-runner')

export async function getTemplate(options: WebdriverIO.BrowserRunnerOptions, env: Environment, spec: string, p = process) {
    const root = options.rootDir || process.cwd()
    const rootFileUrl = url.pathToFileURL(root).href
    const isHeadless = options.headless || Boolean(process.env.CI)
    const alias = (options.viteConfig as (InlineConfig | undefined))?.resolve?.alias || {}
    const usesTailwindCSS = await hasFileByExtensions(path.join(root, 'tailwind.config'))

    let vueDeps = ''
    if (options.preset === 'vue') {
        try {
            const vueDir = path.dirname(url.fileURLToPath(await resolve('vue', `${rootFileUrl}/node_modules`)))
            const vueScript = (await fs.readFile(path.join(vueDir, 'dist', 'vue.global.prod.js'), 'utf-8')).toString()
            vueDeps += /*html*/`
            <script type="module">
                ${vueScript}
                window.Vue = Vue
            </script>`
            const vueCompilerDir = path.dirname(url.fileURLToPath(await resolve('@vue/compiler-dom', `${rootFileUrl}/node_modules`)))
            const vueCompilerScript = (await fs.readFile(path.join(vueCompilerDir, 'dist', 'compiler-dom.global.prod.js'))).toString()
            vueDeps += /*html*/`
            <script type="module">
                ${vueCompilerScript}
                window.VueCompilerDOM = VueCompilerDOM
            </script>`
        } catch (err: any) {
            throw new Error(
                `Fail to set-up Vue environment: ${err.message}\n\n` +
                'Make sure you have "vue" and "@vue/compiler-dom" installed as dependencies!\n' +
                `Error: ${err.stack}`
            )
        }
    }

    let sourceMapScript = ''
    let sourceMapSetupCommand = ''
    try {
        const sourceMapSupportDir = await resolve('source-map-support', import.meta.url)
        sourceMapScript = /*html*/`<script src="/@fs/${url.fileURLToPath(path.dirname(sourceMapSupportDir))}/browser-source-map-support.js"></script>`
        sourceMapSetupCommand = 'sourceMapSupport.install()'
    } catch (err: unknown) {
        log.error(`Failed to setup source-map-support: ${(err as Error).message}`)
    }

    const mochaPath = await resolve('mocha', `${rootFileUrl}/node_modules`)
    const mochaCSSHref = path.join(url.fileURLToPath(path.dirname(mochaPath)), 'mocha.css')
    const mochaJSSrc = path.join(url.fileURLToPath(path.dirname(mochaPath)), 'mocha.js')

    return /* html */`
    <!doctype html>
    <html>
        <head>
            <title>WebdriverIO Browser Test</title>
            <link rel="icon" type="image/x-icon" href="https://webdriver.io/img/favicon.png">
            ${usesTailwindCSS ? /*html*/`<link rel="stylesheet" href="/node_modules/tailwindcss/tailwind.css">` : ''}
            <script type="module">
                const alias = ${JSON.stringify(alias)}
                window.__wdioMockCache__ = new Map()
                window.wdioImport = function (modName, mod) {
                    /**
                     * attempt to resolve direct import
                     */
                    if (window.__wdioMockCache__.get(modName)) {
                        return window.__wdioMockCache__.get(modName)
                    }

                    /**
                     * if above fails, check if we have an alias for it
                     */
                    for (const [aliasName, aliasPath] of Object.entries(alias)) {
                        if (modName.slice(0, aliasName.length) === aliasName) {
                            modName = modName.replace(aliasName, aliasPath)
                        }
                    }
                    if (window.__wdioMockCache__.get(modName)) {
                        return window.__wdioMockCache__.get(modName)
                    }
                    return mod
                }
            </script>
            <link rel="stylesheet" href="/@fs/${mochaCSSHref}">
            <script type="module" src="/@fs/${mochaJSSrc}"></script>
            ${sourceMapScript}
            <script type="module">
                ${sourceMapSetupCommand}

                /**
                 * Inject environment variables
                 */
                window.__wdioEnv__ = ${JSON.stringify(env)}
                window.__wdioSpec__ = '${spec}'
                window.__wdioEvents__ = []
                /**
                 * listen to window errors during bootstrap phase
                 */
                window.__wdioErrors__ = []
                addEventListener('error', (ev) => window.__wdioErrors__.push({
                    filename: ev.filename,
                    message: ev.message,
                    error: ev.error.stack
                }))
                /**
                 * mock process
                 */
                window.process = window.process || {
                    platform: 'browser',
                    env: ${JSON.stringify(p.env)},
                    stdout: {},
                    stderr: {},
                    cwd: () => ${JSON.stringify(p.cwd())},
                }
            </script>
            <script type="module" src="@wdio/browser-runner/setup"></script>
            <style>
                ${MOCHA_VARIABELS}

                body {
                    width: calc(100% - 500px);
                    padding: 0;
                    margin: 0;
                }
            </style>
            ${vueDeps}
        </head>
        <body>
            <mocha-framework spec="${spec}" ${isHeadless ? 'style="display: none"' : ''}></mocha-framework>
            <script type="module">
                window.process.env = ${JSON.stringify(p.env)}
            </script>
        </body>
    </html>`
}

export async function userfriendlyImport(preset: FrameworkPreset, pkg?: string) {
    if (!pkg) {
        return {}
    }

    try {
        return await import(pkg)
    } catch (err: any) {
        throw new Error(
            `Couldn't load preset "${preset}" given important dependency ("${pkg}") is not installed.\n` +
            `Please run:\n\n\tnpm install ${pkg}\n\tor\n\tyarn add --dev ${pkg}`
        )
    }
}

export function normalizeId(id: string, base?: string): string {
    if (base && id.startsWith(base)) {
        id = `/${id.slice(base.length)}`
    }

    return id
        .replace(/^\/@id\/__x00__/, '\0') // virtual modules start with `\0`
        .replace(/^\/@id\//, '')
        .replace(/^__vite-browser-external:/, '')
        .replace(/^node:/, '')
        .replace(/[?&]v=\w+/, '?') // remove ?v= query
        .replace(/\?$/, '') // remove end query mark
}

export async function getFilesFromDirectory (dir: string) {
    /**
     * check if dir exists
     */
    const isExisting = await fs.access(dir).then(() => true, () => false)
    if (!isExisting) {
        return []
    }

    let files = await fs.readdir(dir)
    files = (await Promise.all(files.map(async file => {
        const filePath = path.join(dir, file)
        const stats = await fs.stat(filePath)
        if (stats.isDirectory()) {
            return getFilesFromDirectory(filePath)
        } else if (stats.isFile()) {
            return filePath
        }
    }))).filter(Boolean) as string[]

    return files.reduce((all, folderContents) => all.concat(folderContents), [] as string[])
}

let mockedModulesList: ([string, string])[]
export async function getManualMocks(automockDir: string) {
    /**
     * read available mocks only one time
     */
    if (!mockedModulesList) {
        mockedModulesList = (await getFilesFromDirectory(automockDir))
            /**
             * seperate to module name and actual path
             */
            .map((filePath) => [
                filePath,
                filePath.slice(automockDir.length + 1).slice(0, -path.extname(filePath).length)
            ])
    }

    return mockedModulesList
}

const EXTENSION = ['.js', '.ts', '.mjs', '.cjs', '.mts']
export async function hasFileByExtensions (p: string, extensions = EXTENSION) {
    return (await Promise.all([
        fs.access(p).then(() => p, () => undefined),
        ...extensions.map((ext) => fs.access(p + ext).then(() => p + ext, () => undefined))
    ])).filter(Boolean)[0]
}

export function hasDir (p: string) {
    return fs.stat(p).then((s) => s.isDirectory(), () => false)
}

export function getErrorTemplate(filename: string, error: Error) {
    return /*html*/`
        <pre>${error.stack}</pre>
        <script type="module">
            window.__wdioErrors__ = [{
                filename: "${filename}",
                message: \`${error.message}\`
            }]
        </script>
    `
}

const SUPPORTED_ASYMMETRIC_MATCHER = {
    Any: 'any',
    Anything: 'anything',
    ArrayContaining: 'arrayContaining',
    ObjectContaining: 'objectContaining',
    StringContaining: 'stringContaining',
    StringMatching: 'stringMatching',
    CloseTo: 'closeTo'
} as const

/**
 * utility function to transform assertion parameters into asymmetric matchers if necessary
 * @param arg raw value or a stringified asymmetric matcher
 * @returns   raw value or an actual asymmetric matcher
 */
export function transformExpectArgs (arg: any) {
    if ('$$typeof' in arg && Object.keys(SUPPORTED_ASYMMETRIC_MATCHER).includes(arg.$$typeof)) {
        const matcherKey = SUPPORTED_ASYMMETRIC_MATCHER[arg.$$typeof as keyof typeof SUPPORTED_ASYMMETRIC_MATCHER] as keyof AsymmetricMatchers
        // @ts-expect-error
        const matcher: any = arg.inverse ? expect.not[matcherKey] : expect[matcherKey]

        if (!matcher) {
            throw new Error(`Matcher "${matcherKey}" is not supported by expect-webdriverio`)
        }

        return matcher(arg.sample)
    }

    return arg
}
