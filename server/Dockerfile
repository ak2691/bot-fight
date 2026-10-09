FROM maven:3.9-eclipse-temurin-21 AS build
WORKDIR /app
COPY pom.xml .
RUN mvn dependency:go-offline -B
COPY src ./src
# The shared gameplay data: pom.xml copies ../shared/gameplay (here /shared/gameplay) onto the classpath.
COPY --from=shared . /shared
RUN mvn clean package -DskipTests
FROM eclipse-temurin:21-jre-jammy
RUN groupadd --system app && useradd --system --gid app app
WORKDIR /app
COPY --from=build --chown=app:app /app/target/*.jar app.jar
USER app
EXPOSE 8080
ENTRYPOINT ["java", "-XX:MaxRAMPercentage=75.0", "-jar", "app.jar"]
