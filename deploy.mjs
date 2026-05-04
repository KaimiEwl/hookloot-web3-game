import { NetlifyAPI } from 'netlify';

const client = new NetlifyAPI('nfp_886om7LmD6kcpqFzhxYXBNgZNuCYo4jebbc5');

async function deploy() {
    console.log('Creating site...');
    try {
        const site = await client.createSite({
            body: {
                name: 'nft-miner-game-' + Math.floor(Math.random() * 1000000)
            }
        });

        console.log('Site created:', site.name, site.url);
        console.log('Site ID:', site.id);

        console.log('Deploying dist folder...');
        const deploy = await client.deploy(site.id, './dist');

        console.log('Deploy complete!');
        console.log('Live URL:', deploy.deploy.ssl_url);
    } catch (error) {
        console.error('Error deploying:', error);
    }
}

deploy();
