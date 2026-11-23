package br.com.ckgroup.autonick.osapi.web;

import br.com.ckgroup.autonick.osapi.config.PwaProperties;
import java.io.IOException;
import java.nio.file.Path;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.io.Resource;
import org.springframework.web.servlet.config.annotation.ResourceHandlerRegistry;
import org.springframework.web.servlet.config.annotation.ViewControllerRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;
import org.springframework.web.servlet.resource.PathResourceResolver;

/** Arquivos estáticos da PWA, quando {@code autonick.pwa.pasta} estiver definida; pasta termina em index.html. */
@Configuration
public class PwaConfig implements WebMvcConfigurer {

    private final PwaProperties pwa;

    public PwaConfig(PwaProperties pwa) {
        this.pwa = pwa;
    }

    /** A raiz não chega ao resolvedor de arquivos (o caminho vazio é descartado antes): encaminha para a página inicial. */
    @Override
    public void addViewControllers(ViewControllerRegistry registro) {
        if (pwa.ativa()) registro.addViewController("/").setViewName("forward:/index.html");
    }

    @Override
    public void addResourceHandlers(ResourceHandlerRegistry registro) {
        if (!pwa.ativa()) return;
        String local = Path.of(pwa.pasta()).toAbsolutePath().normalize().toUri().toString();
        registro.addResourceHandler("/**").addResourceLocations(local.endsWith("/") ? local : local + "/")
                .resourceChain(false).addResolver(new PathResourceResolver() {
                    @Override
                    protected Resource getResource(String caminho, Resource local) throws IOException {
                        if (caminho.isEmpty() || caminho.endsWith("/")) caminho = caminho + "index.html";
                        if (caminho.startsWith("api/")) return null;
                        Resource r = super.getResource(caminho, local);
                        if (r == null && !caminho.contains(".")) r = super.getResource(caminho + "/index.html", local);
                        return r;
                    }
                });
    }
}
