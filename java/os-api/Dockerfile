# AutoniCK API Java (Spring Boot) em contêiner, para uma futura demonstração pública (hospedagem ainda não escolhida).
# Contexto de build: esta pasta (java/os-api). A PWA fica na hospedagem estática; a API atende só /api.
FROM eclipse-temurin:21-jdk AS build
WORKDIR /src
COPY .mvn .mvn
COPY mvnw pom.xml ./
RUN chmod +x mvnw && ./mvnw -q -B dependency:go-offline
COPY src src
RUN ./mvnw -q -B -DskipTests package && cp target/os-api-*.jar /src/app.jar

FROM eclipse-temurin:21-jre
WORKDIR /app
RUN useradd --system --uid 10001 autonick
COPY --from=build /src/app.jar /app/app.jar
USER autonick
# Memória e partida: limites relativos ao contêiner, coletor simples e JIT rápido (instâncias curtas e suspensas).
ENV JAVA_TOOL_OPTIONS="-XX:MaxRAMPercentage=75 -XX:+UseSerialGC -XX:TieredStopAtLevel=1 -Xss512k" \
    AUTONICK_AUTH_MODO=demo \
    AUTONICK_DEMO_PUBLICA=true \
    AUTONICK_DEMO_COOKIE_SEGURO=true \
    AUTONICK_LIMITE_ESCRITAS=60 \
    AUTONICK_LIMITE_LEITURAS=600 \
    AUTONICK_DB_POOL=3
# A plataforma informa a porta em PORT (padrão 8081 fora dela).
EXPOSE 8081
CMD ["java", "-jar", "/app/app.jar"]
