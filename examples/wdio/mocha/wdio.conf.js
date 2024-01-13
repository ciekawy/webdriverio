import url from 'node:url'

const __dirname = url.fileURLToPath(new URL('.', import.meta.url))

export const config = {
    /**
     * specify test files
     */
    specs: [
        './mocha.test.js'
    ],

    /**
     * capabilities
     */
    capabilities: [{
        browserName: 'firefox'
    }],

    /**
     * test configurations
     */
    logLevel: 'trace',
    framework: 'mocha',
    outputDir: __dirname,

    reporters: ['spec', 'dot', 'junit'],

    mochaOpts: {
        ui: 'bdd',
        timeout: 15000
    },
    services: ['devtools'],

    /**
     * hooks
     */
    onPrepare: function() {
        // eslint-disable-next-line
        console.log('let\'s go')
    },
    onComplete: function() {
        // eslint-disable-next-line
        console.log('that\'s it')
    }
}
